"""Launcher tests use temporary projects, never the developer's .env or database."""
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest
import tempfile

spec = importlib.util.spec_from_file_location("dev_mobile", Path(__file__).with_name("dev-mobile.py"))
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class LauncherTests(unittest.TestCase):
    def test_config_preserves_existing_settings_and_updates_managed_phone_url(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); backend = root / "backend"; mobile = root / "mobile"
            backend.mkdir(); mobile.mkdir()
            credential = root / "credential.json"; credential.write_text('{}')
            backend_env = backend / ".env"
            backend_env.write_text(f"DATABASE_URL=postgresql://localhost/existing\nGOOGLE_CLOUD_PROJECT=test-project\nGOOGLE_CLOUD_LOCATION=us-central1\nGEMINI_MODEL=test-model\nGEMINI_LIVE_MODEL=test-live\nGCS_BUCKET_NAME=test-bucket\nGOOGLE_APPLICATION_CREDENTIALS={credential}\nAUTH0_DOMAIN=tenant.example.com\nAUTH0_AUDIENCE=test-audience\n")
            original = backend_env.read_text()
            (mobile / ".env").write_text("EXPO_PUBLIC_BACKEND_URL=http://192.168.1.10:8000\nMAMDANI_DEV_MANAGED_URL=1\n")
            args = SimpleNamespace(non_interactive=True, host="192.168.1.20", port=8001)
            with patch.object(dev, "BACKEND", backend), patch.object(dev, "MOBILE", mobile), patch.dict(os.environ, {}, clear=True):
                settings, local, url = dev.configure(args)
            self.assertFalse(local); self.assertEqual(url, "http://192.168.1.20:8001")
            self.assertEqual(settings.google_cloud_project, "test-project")
            self.assertEqual(backend_env.read_text(), original)

    def test_new_config_uses_local_db_and_reports_missing_key_without_printing_secrets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); backend = root / "backend"; mobile = root / "mobile"
            backend.mkdir(); mobile.mkdir()
            (backend / ".env.example").write_text("DATABASE_URL=postgresql://user:password@host/database\nGOOGLE_CLOUD_PROJECT=\nGCS_BUCKET_NAME=\nAUTH0_DOMAIN=your-tenant.auth0.com\nAUTH0_AUDIENCE=your-api\n")
            args = SimpleNamespace(non_interactive=True, host=None, port=8000)
            with patch.object(dev, "BACKEND", backend), patch.object(dev, "MOBILE", mobile), patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(dev.DevError, "Set GOOGLE_CLOUD_PROJECT"):
                    dev.configure(args)
            saved = (backend / ".env").read_text()
            self.assertIn(dev.LOCAL_DB, saved); self.assertIn("localhost", saved)
            self.assertFalse((mobile / ".env").exists())

    def test_external_database_is_not_migrated_without_flag(self):
        connection = Mock(); connection.execute.return_value.fetchone.side_effect = [(None,), (None,)]
        manager = Mock(); manager.__enter__ = Mock(return_value=connection); manager.__exit__ = Mock(return_value=False)
        with patch("psycopg.connect", return_value=manager):
            with self.assertRaisesRegex(dev.DevError, "--migrate"):
                dev.prepare_database(SimpleNamespace(connection_url=lambda: "postgresql://localhost/test"), False,
                                     SimpleNamespace(migrate=False))
        self.assertEqual(connection.execute.call_count, 2)

    def test_cleanup_stops_every_child_process_group(self):
        first, second = Mock(pid=123), Mock(pid=456)
        first.poll.return_value = second.poll.return_value = None
        with patch.object(dev.os, "killpg") as kill:
            dev.stop_processes([first, second])
        self.assertEqual([call.args[0] for call in kill.call_args_list], [456, 123])
        first.wait.assert_called_once(); second.wait.assert_called_once()


if __name__ == "__main__":
    unittest.main()
