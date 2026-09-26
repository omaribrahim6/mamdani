# Mamdani — phone app

The citizen side of Mamdani as a native app for **Expo Go** (SDK 57). The camera is up the moment it
opens and tiny Mamdani is already in his round window, watching it through Gemini Live. Talk to him
all you like: nothing is filed until you tap the shutter. The shutter freezes the photo, location,
time and what you just said into one report; one Gemini decision comes back; Mamdani suits up,
walks out of his window and into your photo, marks the problem and tells you it's reported. Then you
can keep talking to him about that report.

How it's put together:

- `src/flow/machine.ts`: the single state machine (`LIVE_IDLE` → … → `LIVE_CONVERSATION`). Mamdani's
  mode, whether Live may speak, and whether the mic and camera stream are all derived from it.
- `src/live/`: Gemini Live over a WebSocket (ephemeral token from `/api/live`), mic PCM via expo-audio.
- `src/voice.ts`: one voice for every line (ElevenLabs via `/api/voice`).
- The web app's `/api/submit` analyzes and commits exactly once per shutter press (session id).
- The 3D mayor is the same three.js code as the web (`components/mayor`), drawn through `expo-gl`.

## Run it on your phone

1. Install **Expo Go** from the App Store or Play Store.
2. From this folder:

   ```bash
   npm install
   npm start
   ```

3. Scan the QR code: with the Camera app on iPhone, or from inside Expo Go on Android.

If the phone can't reach your laptop (venue Wi-Fi often blocks it), use a tunnel:

```bash
npm run tunnel
```

## Pointing at a different server

Reports go to `https://mamdani.vercel.app` by default. To use a local `npm run dev`, copy
`.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to your laptop's LAN address, e.g.
`http://192.168.1.20:3000`.
