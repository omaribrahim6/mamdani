# Run the mobile app locally

From the repository root:

```sh
npm run dev:mobile -- --ios
```

Or for Android:

```sh
npm run dev:mobile -- --android
```

The first run prompts for your **Google Cloud project ID**, **private GCS bucket name**, and
**Google credential JSON path** if needed. It saves them in ignored `backend/.env`.
You still need access to the Gemini models and the bucket; the launcher does not
create cloud accounts, keys, or buckets. If you already authenticated with
`gcloud auth application-default login`, no credential-file prompt is needed.

The launcher installs dependencies when needed, starts local Postgres in Docker,
applies its schema, finds your LAN IP, configures the mobile backend URL, starts
the API and photo worker, and builds/installs the app with Expo. Native build
errors show in the same terminal. Backend Python changes reload automatically;
restart the launcher after changes to the photo worker.

Requirements: Python 3.11+, Node/npm, and Docker Desktop running. For iPhone, use
Xcode/CocoaPods and a connected, trusted iPhone with Developer Mode enabled. For
Android, use the Android SDK/JDK and a connected device with USB debugging. Keep
your computer and phone on the same Wi-Fi. **Expo Go is not supported.**

Once the development app is installed, day-to-day startup is simply:

```sh
npm run dev:mobile
```

Open the installed development app and connect to the Expo server shown in the
terminal. Test **Report issue**: grant permissions, describe the visible issue,
wait for the automatic photo and success popup, then check `[PHOTO]` logs for the
upload acknowledgment.

**Ctrl+C** stops the API, worker, and Expo together. Postgres stays running and
keeps your reports. To stop the database without deleting data:

```sh
npm run dev:mobile -- --stop-db
```

## Existing database or custom network

A real `DATABASE_URL` already configured in `backend/.env` is preserved; Docker
is used only for the launcher's default local database. The launcher does not
change an external database schema unless you explicitly pass `--migrate`:

```sh
npm run dev:mobile -- --migrate --ios
```

Shell environment variables override backend `.env` settings. Existing cloud
credentials and Gemini settings are preserved. Local submission does not need an
Auth0 account: missing Auth0 settings receive local defaults. Authenticated GET
requests still require a real Auth0 setup.

Override LAN detection or the backend port:

```sh
npm run dev:mobile -- --host 192.168.1.25 --port 8001 --expo-port 8082
```

The launcher updates its own generated mobile URL as your IP changes. A URL you
already configured yourself is preserved unless `--host` is supplied. Set the
backend URL to your Mac's IP, not `localhost`, when using a physical phone.

Check setup without starting the API, worker, or Expo:

```sh
npm run dev:mobile -- --check
```

This can install dependencies, create local configuration, and prepare/start the
local database. It checks Expo URL configuration, database connectivity/schema,
Vertex AI credentials/model availability, Auth0 signing keys (except local defaults), and
photo bucket object create/read permissions. Startup uses read-only probes;
a real report verifies generation, live sessions, and uploads. Add `--non-interactive` to
get a clear setup error instead of prompts when running in automation.

Detailed service configuration and photo-worker operations:
[backend setup](backend/README.md), [mobile setup](mobile/README.md).
