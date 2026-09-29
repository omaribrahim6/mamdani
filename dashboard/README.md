# Mamdani Command

The City of Ottawa's side of Mamdani: every resident report, deduplicated and triaged by Gemini, on one screen. It reads the same Tiger Data record the phone app writes to, through the Next.js API at the repo root.

## Run it

```sh
# terminal 1, repo root: the API (Tiger Data + Vertex AI from .env.local)
npm run dev

# terminal 2
cd dashboard
npm install
npm run dev        # http://localhost:5173
```

`dashboard/.env` needs `VITE_MAPBOX_ACCESS_TOKEN`, `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID`. `/api` is proxied to `http://localhost:3000`; set `API_PROXY` to use a deployment instead. A standalone deployment sets `VITE_API_URL` to the API's origin (the API sends CORS headers).

## Front door and routes

There's no sign-in — this is a public demo. `/` is the front door; everything else lives under `/admin/`:

| Path | Page |
| --- | --- |
| `/admin/` | Command |
| `/admin/map` | Live map |
| `/admin/queue` | Work queue |
| `/admin/analytics` | Analytics |
| `/admin/brief` | Today's brief |

The front door's **View the portal** button opens a heads-up that the AI is switched off, then drops you into `/admin/` read-only. Any `/admin/` link opens the dashboard directly.

## What's on it

| Page | What staff do there |
| --- | --- |
| **Command** | See the city at a glance: reports per hour with the next hours projected, the resolution pipeline, service-target and accessibility tiles, department load, the live map, Gemini's read of the day, and the top of the work queue. |
| **Live map** | Mapbox Standard in monochrome with 3D buildings (day/night follows the theme). Filter by status and type, show report heat, replay the last 7 days hour by hour, and pick stops for a crew run that gets ordered (nearest neighbour + 2-opt) and driven with Mapbox Directions. |
| **Work queue** | Every issue ranked by an explainable priority, with service-target clocks. Tabs by stage, bulk assign/start/fix, "plan crew route" for a selection, CSV export. |
| **Analytics** | Open backlog over 72h, weekday × hour report heatmap, workload by department and stage, age against service target by type, and neighbourhood equity (barriers and late work by area). Each card has **Explain**, which hands it to Mamdani. |
| **Brief** | Gemini's daily memo: headline, priorities with reasons and actions, crew plan (route any crew in one click), watch list, next-24h outlook, and web-grounded conditions with sources. Mamdani reads it aloud. |

Everywhere:

- **Issue drawer**: evidence photo with Gemini's bounding box (or satellite view), severity/safety/accessibility scores, the priority broken into its parts, the service-target clock, **Gemini's work plan** (crew, CAD cost range, materials, steps, traffic control, risk of waiting, ROI, and a resident update to copy), nearby open issues to batch, history, and the residents' own words. Print it as a work order.
- **Ctrl K**: jump to any work order or street; describe a problem ("water across the crosswalk") and it searches the evidence photos with Gemini embeddings in pgvector.
- **Ask Mamdani (Ctrl J)**: the 3D Mamdani leans out of the bottom-right corner and follows your cursor. Open him and he answers from the city record through tools (query issues, open a work order, citywide numbers, photo search), researches the outside world with Google Search grounding (sources shown), highlights issues on the map, plans crew routes, and proposes status changes that a person confirms. He speaks with Gemini TTS (the Orus voice, same as the phone), his mouth following the audio, and announces new reports as they land.
- Live updates every 4 seconds, toasts for new reports and confirmations, an activity feed, and light/dark themes.

## Gemini and Google Cloud

| Model / API | Used for |
| --- | --- |
| `gemini-3.8-flash` (Vertex AI) | Ask Mamdani (streamed function calling), the daily brief, work plans |
| Google Search grounding | Weather, standards, costs and news, with citations |
| `gemini-embedding-2` | Text → the evidence photos' vector space for photo search (pgvector DiskANN in Tiger Data) |
| `gemini-2.5-flash-tts` | Mamdani's voice |

Server code: `lib/command/` (agent, record, brief, work plans, research) and `app/api/{ask,brief,search,activity,speak,issues/[id]/plan}`.

## Icons

`/icon.html` (dev only) renders Mamdani's face from the 3D model and writes the favicon, the dashboard icons and the phone app's icons.
