# Mamdani — phone app

The citizen side of Mamdani as a native app for **Expo Go** (SDK 57). Point the camera at what's
broken, tap (or hold and talk), and tiny Mamdani walks into your photo, plants his flag and files
the work order.

The app is a client of the web app's API (`/api/report`, `/api/issues/:id`, `/api/voice`,
`/api/where`), so Gemini, duplicate detection and Tiger Data all run on the server. The 3D mayor is
the same three.js code as the web (`components/mayor`), drawn through `expo-gl`.

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
