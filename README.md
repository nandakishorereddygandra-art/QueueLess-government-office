# Tap Token

Tap Token is a mobile-first civic queue-management application with citizen, staff and office-admin portals. Every citizen’s time matters. It uses Node.js and MongoDB.

## Run locally

1. Install Node.js 20 or newer and MongoDB Community Server, or have a MongoDB Atlas connection string.
2. Run `npm install`.
3. For Atlas or another hosted server, copy `.env.example` to `.env` and set `MONGODB_URI` to your connection string. The `.env` file is ignored by Git. For local MongoDB, the default URI is `mongodb://127.0.0.1:27017/govqueue`.
4. From this folder, run `npm start`.
5. Open `http://localhost:4173`.

MongoDB Compass can connect to the same server using the URI configured for the app. The app stores offices, services, tokens, staff, notifications, and audit entries in separate collections in the `govqueue` database. New databases start with empty collections. Never commit or share `.env`; it contains database credentials.

## Main paths

- **Citizen:** Book a token, inspect document requirements, view the QR check-in panel, track a live countdown based on the estimated queue wait, and read notifications. Opening a nearby office shows its services and a checkable document-readiness list before booking.
- **Admin:** Switch portals from the profile control. Review the dashboard, manage the queue, reschedule or skip tokens with a required reason, and inspect the resulting audit trail.
- **Staff:** Call citizens and mark visits complete from the counter queue.

## Officer access

The public citizen portal is open to anyone. Configure `ADMIN_NAME`, `ADMIN_PIN`, `STAFF_NAME`, and `STAFF_PIN` in `.env` to enable server-verified officer sign-in. Successful sign-in creates an HTTP-only session cookie, and the server checks the session and role for each queue-changing request. Sessions expire after eight hours and reset when the server restarts.

- **Public Citizen:** Open access (no login required).

## Architecture

- `server.js` is a lightweight Node HTTP server with REST endpoints, an in-memory cache backed by MongoDB, debounced persistence, and native Server-Sent Events (`/api/events`) for queue push updates.
- `app.js` and `styles.css` implement the multi-page client interface, targeted DOM updates (avoiding full UI tearing), real-time SSE streaming, Web Audio API chime synthesis, Web Speech API counter voice announcements, and responsive civic theme.
- MongoDB is the persistent source of app state. Mutations update in-memory state immediately and flush to the collections asynchronously.
- Dedicated **Lobby TV Display Board** (`#/display`) presents waiting hall monitors with active counters and real-time announcements.
- Simulated SMS alerts are dispatched on-screen when citizens reach 2 tokens away from service.

## App paths

- **Citizen:** Book a token, inspect document requirements, view the QR check-in panel, track a live countdown based on estimated wait, and hear audio chimes when called.
- **Admin:** Review office metrics, manage live queues, reschedule or skip tokens with required audit reason, and monitor counter load.
- **Staff:** Call citizens and mark visits complete from the counter queue with immediate broadcast to all devices.
- **Public TV Board:** Open `http://localhost:4173/#/display` in a lobby screen or split window to observe live counter updates and audible announcements in real time.

