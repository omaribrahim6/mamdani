# Municipal reporting backend

The API checks database/photo schema, Vertex AI credentials/model availability, and Auth0
signing keys before serving requests. Local Auth0 defaults skip the signing-key
check. The photo worker checks storage credentials and bucket object create/read
permissions before polling. Failures stop startup with a setup error. These
read-only checks do not verify generation, live sessions, or an actual upload.
Worker logs print job attempts, compression sizes, upload stages, lease loss,
completion timings, and failure classes without credentials or photo contents.

For one-command local startup, see [DEV.md](../DEV.md):
`npm run dev:mobile -- --ios` from the repository root.

Standalone Python 3.11+ FastAPI service. POST is public; GET requires an Auth0
RS256 access token issued for your API audience. Reports are processed by two
sequential Gemini calls and stored in PostgreSQL. Successful POST responses
contain only `{"status":"success"}` after the database transaction commits.

## Setup

Run from this directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[test]'
cp .env.example .env
```

Fill in all five required settings: `DATABASE_URL`, `GOOGLE_CLOUD_PROJECT`,
`GEMINI_MODEL`, `AUTH0_DOMAIN`, and `AUTH0_AUDIENCE`. The Auth0 domain is a
hostname without `https://`; audience is the identifier of your Auth0 API.
Obtain GET access tokens through your existing Auth0 application with that
audience. This service does not provision an Auth0 tenant or issue tokens.

Gemini runs through **Google Cloud Vertex AI**, with service-account credentials
or Application Default Credentials. Enable billing and `aiplatform.googleapis.com`
in `GOOGLE_CLOUD_PROJECT`. Grant the runtime identity `roles/aiplatform.user`
(Vertex AI User) on that project. Set `GOOGLE_CLOUD_LOCATION=us-central1` or a
region supporting your chosen models. `GEMINI_API_KEY` is no longer used.

For local user credentials, run `gcloud auth application-default login` and
`gcloud auth application-default set-quota-project YOUR_PROJECT_ID`. Alternatively
set `GOOGLE_APPLICATION_CREDENTIALS` to an existing service-account JSON file;
the backend explicitly loads that file from `.env` for both analysis and live
sessions. Give the same identity object create/read access on the photo bucket.
The default Vertex live model is `gemini-live-2.5-flash-native-audio`.

Remote database connections always use `sslmode=verify-full`. Configure
`DATABASE_SSL_ROOT_CERT` if the provider requires a CA certificate file.
Localhost connections use the TLS options in the supplied URL.

Apply the schema explicitly with an authorized database account. Supply the
connection URL using your shell's environment or PostgreSQL connection setup;
the `.env` file is read by the application, not by `psql`.

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

`schema.sql` creates a new regular PostgreSQL table, compatible with TigerCloud,
and requires permission to enable `uuid-ossp`. It does not migrate a preexisting
table with a different schema. The application never runs schema changes.

## Requests

Public ingestion:

```sh
curl -i http://127.0.0.1:8000/api/v1/reports \
  -H 'Content-Type: application/json' \
  -d '{"audio_transcription":"A deep pothole in the curb lane.","video_transcription":"Road surface damage near the crossing.","latitude":45.5017,"longitude":-73.5673}'
```

Success: HTTP 201, `{"status":"success"}`. Both transcription fields are required,
at least one must contain text, and each is limited to 20,000 characters.
Coordinates are range-validated; physical GPS authenticity is not established.
No reverse-geocoding service is called, so street addresses are null.

Authenticated retrieval (set `ACCESS_TOKEN` to an Auth0 access token):

```sh
curl 'http://127.0.0.1:8000/api/v1/reports?tag=roads&min_severity=5' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

GET returns all matching reports newest first, including raw evidence, analysis,
location, and review status. Permitted tags: `roads`, `lights`, `sanitation`,
`utilities`. `min_severity` accepts integers 1–10. Cost tier is a qualitative
repair priority (`Low`, `Medium`, `High`), not a monetary estimate.
Confidence below 0.60 sets `needs_review`; other reports have `processed` status.
Status is calculated before confidence is rounded to two decimals for storage.
There is no review-management endpoint.

Errors use a `detail` message: 401 for invalid/missing GET authentication, 422
for invalid input, 502 for unusable model output, and 503 for unavailable services.
Gemini transient failures receive at most three attempts per stage with a
20-second timeout per attempt and exponential delays with jitter. A request can
therefore take over two minutes when both stages retry; configure your calling
client/proxy accordingly. A rejected AI result never creates a partial report.
Re-submitting a report creates a new record; no deduplication is performed.

## Verification

```sh
pytest -q
```

Unit and API tests use mocked external services. The PostgreSQL integration
test is skipped unless `TEST_DATABASE_URL` points to a disposable database.
It creates and drops an isolated test schema and requires extension/schema
creation privileges. To include it:

```sh
TEST_DATABASE_URL='postgresql://user:password@localhost/test_db' pytest -q
```

## Mobile Live relay

`/api/v1/live` is a public WebSocket endpoint for the Expo development app in
`../mobile/`. Set `GEMINI_LIVE_MODEL=gemini-live-2.5-flash-native-audio` or a compatible Live model
available to your Gemini account. The existing `GEMINI_MODEL` still controls the
two report analysis calls. Install the updated dependencies, including the
WebSocket extras: `pip install -e '.[test]'`.

For a physical phone on your local network:

```sh
uvicorn app.main:app --host 0.0.0.0 --port 8000 --ws-max-size 8388608
```

The relay accepts GPS once, streams bounded PCM/JPEG media to Gemini, accumulates
input speech transcription, and executes Gemini's `submit_report` tool using the
existing report POST route. Its visual description is generated by Gemini from
camera evidence; it is not a separate built-in video transcript. Model-supplied
GPS or speech fields are rejected. Success is emitted only after the report POST
returns 201 following a database commit. Apply the report-photo migration described
below before starting this version.

Sessions have a three-minute conversation limit and bounded media queues. Live
audio and preview frames are not saved. A fresh report still is retained in a
durable PostgreSQL job until its compressed copy is uploaded to Cloud Storage. Closing a conversation does not roll back an in-progress
report POST. There are no automatic submission retries or cross-session
deduplication. Put public deployments behind HTTPS/WSS and gateway session/rate
limits. See `../mobile/README.md` for setup, protocol, and device acceptance checks.


## Report photos and background worker

Existing JSON report requests remain supported. To attach a still, include optional
`photo_base64` (raw base64 JPEG, without a data-URL prefix). JPEGs are limited to
4 MiB decoded and 25 million pixels. The report request is capped at 8 MiB. Invalid
images return 422 without echoing their contents. Photo requests require
`GCS_BUCKET_NAME`; when unset they return 503 before model processing. Transcripts
and GPS remain required as before. Image bytes are excluded from AI analysis prompts.

**Upgrade an existing database explicitly**, before deploying this API or worker:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_report_photos.sql
```

For a fresh database, `schema.sql` now includes the photo schema. The migration is
repeatable and preserves existing reports, whose `photo_status` defaults to `none`.
The application never applies migrations automatically.

Set `GCS_BUCKET_NAME` to an existing private Google Cloud Storage bucket. The API
only stages jobs; it does not need Google storage credentials. The worker uses
Application Default Credentials (ADC), e.g. a Google Cloud workload's service
account or `gcloud auth application-default login` during local development.
Alternatively set `GOOGLE_APPLICATION_CREDENTIALS` in the environment or `.env`
to a service-account JSON path; the worker reads that setting explicitly. Never
commit credential files. Grant the worker object creation and read/metadata access
to its bucket so it can verify an existing object after a crash. Public bucket
access is not needed, and the worker never creates or publishes buckets.

Run the worker as a **separate supervised process**, from `backend/`:

```sh
python -m app.photo_worker
# Process at most one ready job (useful for setup verification):
python -m app.photo_worker --once
```

A report and its upload job commit in the same PostgreSQL transaction. POST keeps
returning `201 {"status":"success"}` after that commit; this acknowledges a saved
report and durable photo job, not a completed cloud upload. GET adds `photo_status`
(`none`, `pending`, `uploaded`, `failed`) and nullable `photo_object` (`gs://...`).
These fields do not change the report's AI review `status`. Neither original photo
bytes nor base64 appear in GET. No public/signed image URL or viewing endpoint is
provided.

The worker polls every two seconds. Jobs use `FOR UPDATE SKIP LOCKED`, 120-second
leases, and ownership tokens, so multiple workers and restarts are supported.
It orients the photo, converts to RGB, resizes without upscaling to a maximum
1280-pixel long edge, strips metadata, and encodes optimized JPEG at quality 80.
Compressed bytes are staged before uploading to
`gs://<bucket>/reports/<report-id>/photo.jpg`. The bucket is pinned in each job.
Create-only uploads and checksum checks prevent accidental replacement; an existing
object is accepted only when its report ID, digest, size, and checksum match.

Transient failures get at most five attempts, with 10/20/40/80-second delays
between attempts. Configuration/invalid-image/object-conflict errors fail without
repeated attempts. Completed jobs clear both original and compressed staged bytes.
Failed jobs retain their source for an explicit retry after correcting the cause:

```sh
python -m app.photo_worker --retry-failed REPORT_UUID
```

Monitor worker logs and pending/failed jobs (logs contain IDs/error classes, not
image contents or credentials):

```sql
SELECT state, count(*), min(created_at) AS oldest_job
FROM report_photo_jobs GROUP BY state;
SELECT report_id, attempts, last_error, updated_at
FROM report_photo_jobs WHERE state = 'failed';
```

Keep the worker running; durable pending jobs will wait if it is stopped. Configure
retention/operations for failed staged photos according to your deployment needs.
The API does not report a failed background upload as a failed report submission.
