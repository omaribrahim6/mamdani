#!/usr/bin/env python3
"""One-terminal local development: Postgres, FastAPI, photo worker and Expo."""
from __future__ import annotations

import argparse
import getpass
import hashlib
import ipaddress
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
MOBILE = ROOT / "mobile"
sys.path.insert(0, str(BACKEND))
COMPOSE = ["docker", "compose", "-f", str(ROOT / "compose.dev.yml")]
LOCAL_DB = f"postgresql://mamdani:mamdani_dev@127.0.0.1:{os.environ.get('MAMDANI_DEV_DB_PORT', '5433')}/mamdani"


class DevError(Exception):
    pass


def run(command, cwd=ROOT, env=None, quiet=False):
    result = subprocess.run(command, cwd=cwd, env=env, text=True,
                            stdout=subprocess.PIPE if quiet else None,
                            stderr=subprocess.STDOUT if quiet else None)
    if result.returncode:
        # Quiet readiness probes may include connection details; do not echo them.
        raise DevError(f"Command failed: {command[0]} {' '.join(command[1:3])}")
    return result.stdout


def fingerprint(paths):
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.read_bytes())
    return digest.hexdigest()


def install_dependencies():
    python = BACKEND / ".venv" / "bin" / "python"
    if not python.exists():
        print("Creating the backend Python environment…", flush=True)
        run([sys.executable, "-m", "venv", str(BACKEND / ".venv")])
    marker = BACKEND / ".venv" / ".dev-dependencies"
    version = fingerprint([BACKEND / "pyproject.toml"])
    if not marker.exists() or marker.read_text() != version:
        print("Installing backend dependencies…", flush=True)
        run([str(python), "-m", "pip", "install", "-e", ".[test]"], cwd=BACKEND)
        marker.write_text(version)
    # Re-enter this script inside the venv to use its dotenv/psycopg dependencies.
    if Path(sys.executable).absolute() != python.absolute():
        os.execv(str(python), [str(python), str(Path(__file__).resolve()), *sys.argv[1:]])
    marker = MOBILE / "node_modules" / ".dev-dependencies"
    version = fingerprint([MOBILE / "package.json", MOBILE / "package-lock.json"])
    if not marker.exists() or marker.read_text() != version:
        print("Installing mobile dependencies…", flush=True)
        run(["npm", "ci"], cwd=MOBILE)
        marker.write_text(version)


def missing(value):
    return not value or value.startswith(("your-", "postgresql://user:password@host", "/absolute/path/"))


def lan_address():
    if sys.platform == "darwin":
        for interface in ("en0", "en1"):
            result = subprocess.run(["ipconfig", "getifaddr", interface], capture_output=True, text=True)
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))  # Routing lookup; no packet is sent.
            return sock.getsockname()[0]
    except OSError:
        raise DevError("Could not find a LAN address. Pass --host YOUR_MAC_WIFI_IP.") from None


def configure(args):
    from dotenv import dotenv_values, set_key
    backend_path, mobile_path = BACKEND / ".env", MOBILE / ".env"
    if not backend_path.exists():
        shutil.copyfile(BACKEND / ".env.example", backend_path)
    settings = dict(dotenv_values(backend_path))

    def store(key, value):
        set_key(str(backend_path), key, value)
        settings[key] = value

    # Local defaults avoid requiring an Auth0 account just to test public submission.
    for key, default in {"GEMINI_MODEL": "gemini-2.5-flash", "GEMINI_LIVE_MODEL": "gemini-live-2.5-flash-native-audio",
                         "GOOGLE_CLOUD_LOCATION": "us-central1",
                         "AUTH0_DOMAIN": "localhost", "AUTH0_AUDIENCE": "mamdani-local"}.items():
        if missing(os.environ.get(key, settings.get(key))):
            store(key, default)
    database = os.environ.get("DATABASE_URL", settings.get("DATABASE_URL"))
    if missing(database):
        store("DATABASE_URL", LOCAL_DB)
        database = LOCAL_DB
    for key, question in (("GOOGLE_CLOUD_PROJECT", "Google Cloud project ID"), ("GCS_BUCKET_NAME", "Private GCS bucket name")):
        if missing(os.environ.get(key, settings.get(key))):
            if args.non_interactive or not sys.stdin.isatty():
                raise DevError(f"Set {key} in backend/.env, then run this command again.")
            value = (getpass.getpass(question + ": ") if key.endswith("KEY") else input(question + ": ")).strip()
            if missing(value):
                raise DevError(f"{key} is required to test mobile reporting.")
            store(key, value)

    credential = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", settings.get("GOOGLE_APPLICATION_CREDENTIALS"))
    if not missing(credential):
        if not Path(credential).expanduser().is_file():
            raise DevError("GOOGLE_APPLICATION_CREDENTIALS points to a missing file. Fix backend/.env.")
        if str(Path(credential).expanduser()) != credential:
            store("GOOGLE_APPLICATION_CREDENTIALS", str(Path(credential).expanduser()))
    else:
        import google.auth
        from google.auth.exceptions import DefaultCredentialsError
        try:
            google.auth.default()
        except DefaultCredentialsError:
            if args.non_interactive or not sys.stdin.isatty():
                raise DevError("Set GOOGLE_APPLICATION_CREDENTIALS in backend/.env, or run gcloud auth application-default login.") from None
            path = input("Service-account JSON path (leave blank to use gcloud login): ").strip()
            if path:
                file = Path(path).expanduser().resolve()
                if not file.is_file():
                    raise DevError("That credential file does not exist.")
                store("GOOGLE_APPLICATION_CREDENTIALS", str(file))
            elif shutil.which("gcloud"):
                run(["gcloud", "auth", "application-default", "login"])
            else:
                raise DevError("Install the Google Cloud CLI and run gcloud auth application-default login, or set a credential JSON path in backend/.env.")

    address = args.host or lan_address()
    try:
        ipaddress.IPv4Address(address)
    except ValueError:
        raise DevError("--host must be your computer's LAN IPv4 address.") from None
    mobile_url = f"http://{address}:{args.port}"
    # These are local development files. Values already supplied in the shell win.
    if not mobile_path.exists():
        mobile_path.touch()
    old_mobile = dotenv_values(mobile_path)
    if args.host or not old_mobile.get("EXPO_PUBLIC_BACKEND_URL") or old_mobile.get("MAMDANI_DEV_MANAGED_URL") == "1":
        set_key(str(mobile_path), "EXPO_PUBLIC_BACKEND_URL", mobile_url)
        set_key(str(mobile_path), "MAMDANI_DEV_MANAGED_URL", "1")
    else:
        mobile_url = old_mobile["EXPO_PUBLIC_BACKEND_URL"]
    mobile_url = os.environ.get("EXPO_PUBLIC_BACKEND_URL", mobile_url)
    from app.config import Settings
    # Pydantic reads backend/.env relative to cwd. Avoid printing validation input.
    previous = Path.cwd()
    try:
        os.chdir(BACKEND)
        config = Settings(_env_file=backend_path)
    except Exception:
        raise DevError("Backend configuration is invalid. Check backend/.env.") from None
    finally:
        os.chdir(previous)
    return config, database == LOCAL_DB, mobile_url


def available_port(port):
    try:
        with socket.socket() as sock:
            sock.bind(("0.0.0.0", port))
    except OSError:
        raise DevError(f"Port {port} is already in use. Stop the other process or choose a different port.") from None


def prepare_database(settings, local, args):
    import psycopg
    if local:
        if not shutil.which("docker"):
            raise DevError("Install/start Docker Desktop for the local database, or set DATABASE_URL in backend/.env.")
        try:
            run(["docker", "info"], quiet=True)
        except DevError:
            raise DevError("Docker is not running. Open Docker Desktop, then rerun the launcher.") from None
        print("Starting local Postgres (data persists between runs)…", flush=True)
        run([*COMPOSE, "up", "-d", "--wait", "postgres"])
    try:
        with psycopg.connect(settings.connection_url(), connect_timeout=10) as connection:
            exists = connection.execute("SELECT to_regclass('municipal_reports')").fetchone()[0] is not None
            photo_exists = connection.execute("SELECT to_regclass('report_photo_jobs')").fetchone()[0] is not None
            # Schema changes are automatic only for this launcher's local dev database.
            if local or args.migrate:
                path = BACKEND / ("migrations/001_report_photos.sql" if exists else "schema.sql")
                connection.execute(path.read_text())
                print("Database schema ready.", flush=True)
            elif not exists or not photo_exists:
                raise DevError("Database needs its schema/photo migration. Rerun with --migrate to apply it to DATABASE_URL.")
    except psycopg.Error:
        raise DevError("Could not prepare the database. Check DATABASE_URL, TLS certificate, and database permissions.") from None


def emit_logs(process, label):
    for line in process.stdout:
        print(f"[{label}] {line.rstrip()}", flush=True)


def wait_for_backend(process, port):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise DevError("Backend exited during startup. See the API logs above.")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/openapi.json", timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            time.sleep(.25)
    raise DevError("Backend did not become ready within 30 seconds.")


def stop_processes(processes):
    for process in reversed(processes):
        if process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for process in processes:
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group()
    target.add_argument("--ios", action="store_true", help="Build/install on a connected iPhone, then run Expo")
    target.add_argument("--android", action="store_true", help="Build/install on Android, then run Expo")
    parser.add_argument("--host", help="Override auto-detected LAN IPv4 address")
    parser.add_argument("--port", type=int, default=8000, help="Backend port (default: 8000)")
    parser.add_argument("--expo-port", type=int, default=8081, help="Expo/Metro port (default: 8081)")
    parser.add_argument("--migrate", action="store_true", help="Apply schema/migration to your configured external database")
    parser.add_argument("--non-interactive", action="store_true", help="Fail with a setup message rather than prompting")
    parser.add_argument("--check", action="store_true", help="Check config, dependencies, credentials and database without launching apps")
    parser.add_argument("--stop-db", action="store_true", help="Stop local Docker Postgres without deleting its data")
    args = parser.parse_args()
    if args.stop_db:
        run([*COMPOSE, "stop", "postgres"])
        return 0
    if not all(1 <= port <= 65535 for port in (args.port, args.expo_port)):
        raise DevError("Ports must be between 1 and 65535.")
    if args.port == args.expo_port:
        raise DevError("The backend and Expo need different ports.")
    if not shutil.which("npm"):
        raise DevError("Install Node.js/npm first.")
    install_dependencies()
    settings, local, mobile_url = configure(args)
    available_port(args.port)
    available_port(args.expo_port)
    prepare_database(settings, local, args)
    from app.startup import check_api_services, check_photo_storage, create_storage_client
    try:
        print("Checking Vertex AI models, Auth0 and photo storage access…", flush=True)
        check_api_services(settings)
        client = create_storage_client(settings)
        try:
            check_photo_storage(settings, client)
        finally:
            client.close()
    except RuntimeError as error:
        raise DevError(str(error)) from None
    # Load/validate the same Expo configuration used by standalone npm commands.
    run(["npx", "expo", "config", "--type", "public"], cwd=MOBILE,
        env=dict(os.environ, EXPO_PUBLIC_BACKEND_URL=mobile_url), quiet=True)
    print(f"\nBackend: http://127.0.0.1:{args.port}/docs\nPhone backend: {mobile_url}", flush=True)
    if args.check:
        print("Setup checks passed: Expo config, database schema, Gemini model availability and bucket permissions. Full report generation/live sessions still require a real report.")
        return 0
    env = dict(os.environ, PYTHONUNBUFFERED="1", EXPO_PUBLIC_BACKEND_URL=mobile_url)
    processes = []

    def spawn(command, cwd, label=None):
        process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                                   stdout=subprocess.PIPE if label else None,
                                   stderr=subprocess.STDOUT if label else None, text=True)
        processes.append(process)
        if label:
            threading.Thread(target=emit_logs, args=(process, label), daemon=True).start()
        return process

    def interrupted(signum, frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        api = spawn([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0",
                     "--port", str(args.port), "--ws-max-size", "8388608", "--reload", "--reload-dir", "app"], BACKEND, "API")
        wait_for_backend(api, args.port)
        photo = spawn([sys.executable, "-m", "app.photo_worker"], BACKEND, "PHOTO")
        if args.ios or args.android:
            platform = "ios" if args.ios else "android"
            prebuild = spawn(["npx", "expo", "prebuild", "--platform", platform], MOBILE)
            while prebuild.poll() is None:
                if api.poll() is not None or photo.poll() is not None:
                    raise DevError("A backend process stopped during native preparation. See its logs above.")
                time.sleep(.25)
            if prebuild.returncode:
                raise DevError("Native preparation failed. See Expo logs above.")
            processes.remove(prebuild)
            command = ["npm", "run", platform, "--", "--port", str(args.expo_port)]
            if args.ios:
                command += ["--device"]
        else:
            command = ["npm", "start", "--", "--port", str(args.expo_port)]
        print("\nStarting Expo. Press Ctrl+C to stop the API, worker, and Expo.", flush=True)
        print("The local database stays running with its data. Stop it with --stop-db.\n", flush=True)
        spawn(command, MOBILE)
        while True:
            for process in processes:
                code = process.poll()
                if code is not None:
                    if code:
                        raise DevError("A dev process exited with an error. See its logs above.")
                    return 0
            time.sleep(.25)
    except KeyboardInterrupt:
        print("\nStopping dev processes…", flush=True)
    finally:
        stop_processes(processes)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except DevError as error:
        print(f"\nSetup: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\nSetup cancelled.", file=sys.stderr)
        sys.exit(130)
