# Admin Dashboard

A Vite + React operations dashboard protected by Auth0 Universal Login.

## Run locally

1. Configure an Auth0 **Single Page Application** with these URLs:
   - Allowed Callback URL: `http://localhost:5173`
   - Allowed Logout URL: `http://localhost:5173`
   - Allowed Web Origin: `http://localhost:5173`
2. Copy `.env.example` to `.env` and add the application's Auth0 domain and client ID.
   Add a public Mapbox access token as `VITE_MAPBOX_ACCESS_TOKEN` to enable the 3D report map. Without it, the dashboard shows a designed map-unavailable state and photo viewing continues to work.
3. In this directory, run `npm install` and `npm run dev`.
4. The report data in this visual iteration is mocked in `src/mockReports.ts` and is intentionally separate from the backend API.

The app uses redirect-based authentication with PKCE through `@auth0/auth0-react`. Tokens use the SDK's in-memory cache; no client secret belongs in this frontend.
