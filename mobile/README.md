# Mamdani — phone app

Open it and tiny Mamdani, in his round window, asks what the problem is. Talk it through while he
watches the camera (Gemini Live on Vertex AI). When he has heard and seen enough, he says "hold
steady" and takes the evidence photo himself. One Gemini decision comes back; he suits up, walks out
of his window and into your photo, does what the job needs (flag, cone, clipboard…) and tells you
it's reported — in his own Gemini Live voice. Then you can keep talking to him about it.

## Run it on an iPhone (development build)

Needs a Mac with Xcode, an Apple developer account, and the phone plugged in (Developer Mode on).
Expo Go is not supported: live audio streaming uses native code.

```sh
git checkout omar && git pull
cd mobile
npm install          # also applies patches/ (Xcode 26.2 fix for expo-modules-jsi)
npm run ios:device   # regenerates ios/ from app.json, builds and installs on the phone
```

`ios:device` wipes and regenerates the `ios/` folder, so a native project left over from another
branch can't get in the way. If Xcode asks for a signing team, pick yours (bundle id
`com.mamdani.reporting`). After the first install, day-to-day:

```sh
npm start            # Metro for the installed dev app
```

Nothing to configure: the app talks to the deployed backend at https://mamdani.vercel.app
(override with `EXPO_PUBLIC_API_URL` in `mobile/.env` to use a local `npm run dev`).

## How it's put together

- `src/flow/machine.ts` — the single state machine (`LIVE_IDLE` → `CAPTURING` → … → `LIVE_CONVERSATION`).
  Mamdani's mode, when his voice may be heard, and mic/camera streaming are all derived from it.
- `src/live/client.ts` — Gemini Live over a WebSocket (short-lived token from `/api/live`), with the
  `report_issue` tool he calls when he decides to take the photo.
- `src/live/audio.ts` — mic in / his voice out (react-native-audio-api), echo-safe, with the loudness
  that moves his mouth.
- `/api/submit` (web app) — screens, analyzes and files the photo exactly once, and decides what he
  wears, does and says. Afterwards his answers about the report are checked against the record.
- The 3D Mamdani is shared with the web (`components/mayor`), drawn through `expo-gl`.
