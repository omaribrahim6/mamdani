# Admin Dashboard

A Vite + React operations dashboard protected by Auth0 Universal Login.

## Run locally

1. Configure an Auth0 **Single Page Application** with these URLs:
   - Allowed Callback URL: `http://localhost:5173`
   - Allowed Logout URL: `http://localhost:5173`
   - Allowed Web Origin: `http://localhost:5173`
2. Copy `.env.example` to `.env` and add the application's Auth0 domain and client ID.
3. In this directory, run `npm install` and `npm run dev`.
4. Run the parent Next.js app on port 3000 for live issue and statistics data. Vite proxies `/api` requests to it in development.

The app uses redirect-based authentication with PKCE through `@auth0/auth0-react`. Tokens use the SDK's in-memory cache; no client secret belongs in this frontend.
