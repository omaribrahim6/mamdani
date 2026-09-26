# Mamdani

Report civic problems with a photo and a conversation. An animated inspector helps residents describe the issue, presents the result, and lets them follow its status.

## Architecture

The web and mobile apps share a Next.js backend that analyzes evidence, matches duplicate issues, and stores reports. Mobile also connects directly to Gemini Live for camera and voice conversation.

```mermaid
flowchart TD
    Web["Web app · Next.js"] <-->|Photos and report status| Backend
    Mobile["Mobile app · Expo"] <-->|Photos, report status and Live setup| Backend
    Mobile <-->|Camera frames and voice| Live["Gemini Live"]
    Backend["Next.js API and backend workflows"] <-->|Analysis, screening, embeddings and answer checks| AI["Google AI services"]
    Backend <-->|Coordinates and address| Geo["Nominatim geocoding"]
    Backend <-->|Text and web speech audio| Voice["ElevenLabs"]
    Backend <-->|Issues, reports and evidence| DB["PostgreSQL / TimescaleDB"]
    Backend <-->|Without database configuration| Demo["Seeded in-memory store"]
```

## What it does

- Analyzes photos to identify the problem, severity, safety risk, accessibility impact, and responsible department label.
- Matches nearby reports using location and photo similarity to group the same physical issue.
- Stores evidence and reports, calculates issue priority, and lets residents check report status.
- Animates the inspector and speaks the result; mobile supports live conversation and checks follow-up answers against the saved issue.

## Run the web app

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Use `.env.example` as a starting point for `.env.local` when configuring services. Without database and AI credentials, the app uses seeded memory storage and demo analysis. Live conversation and ElevenLabs speech require their service credentials.

See [mobile setup](mobile/README.md) for the Expo app and [architecture and data flows](docs/architecture.md) for API contracts, database details, and workflow behavior.
