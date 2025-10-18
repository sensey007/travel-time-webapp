# Travel Time Web App

[Deep Link Specification](./DOCS_DEEPLINK.md) | [Deployment Guide](./DEPLOYMENT.md) | [Lab Week Prototype Plan](./LAB_WEEK_PROTOTYPE.md)

Purpose: Provide an XRE-launchable web application that, when opened via deep link containing query parameters (origin, destination, mode, etc.), renders a Google Map with the requested route and travel time information.

## High-Level Flow
1. Voice service constructs deep link: `http://your-host.example/tt?origin=Philadelphia,PA&destination=JFK%20Airport&mode=driving`.
2. XRE launches the deep link in the web container.
3. App parses parameters, validates them, loads Google Maps JS API.
4. App requests Directions + Distance Matrix (optional) from Google Maps.
5. UI displays: map, route polyline, ETA, distance, summary.

## Supported Query Parameters
- `origin` (required): Free-form address or `lat,lng`.
- `destination` (required): Free-form address or `lat,lng`.
- `mode` (optional): `driving | walking | bicycling | transit` (defaults to `driving`).
- `units` (optional): `metric | imperial` (defaults to Google Maps default, can be extended).
- `apiKey` (optional for dev): If not using server-side injection via env var.
- `lang` (optional): UI language code.

## Server Behavior
`server.js` serves `index.html`. If `MAPS_API_KEY` env var is set, it injects it into the HTML (replacing `__GOOGLE_MAPS_API_KEY__`). Else the client looks for `apiKey` in the query string.

### Server-Side Rendered (SSR) & Diagnostic Fallback Modes
These modes let a set‑top box (or very limited browser / CSP context) receive a purely server‑rendered textual response with zero JS and minimal/no CSS.

Modes (add as query params to `/tt` or `/`):
- `ssr=1` – Full SSR fallback. If both `origin` and `destination` are supplied:
  * TravelTime intent (non-food): Performs a Directions API call (if API key present) and returns origin/destination addresses, distance, duration.
  * NearbyFood intent: Performs Geocode + Places Nearby (if API key present) and returns up to 8 restaurants with (optional) rating.
  * Missing API key or unsupported intent → message shown.
  * Always `Cache-Control: no-store`.
- `safe=1` – Minimal HTML page (no styles, no scripts) indicating environment details and usage help.
- `plain=1` – Lightly styled diagnostic page for device render pipeline validation.

Examples:
```
/tt?ssr=1&origin=Philadelphia,PA&destination=JFK%20Airport
/tt?ssr=1&origin=Philadelphia,PA&destination=best%20italian%20restaurants%20near%20me
/tt?safe=1
/tt?plain=1
```
Behavior when API key missing:
- `ssr=1` still returns a 200 HTML page but includes: `No API key or unsupported intent for SSR.`

Rationale:
- Avoid black screens on devices where Google Maps JS cannot load (CSP, network, or JS disabled/timeouts).
- Provide immediate textual feedback for voice initiated deep links.
- Simplify error triage (server logs reflect upstream provider status codes).

Limitations of SSR mode:
- No map polyline visualization.
- No traffic (Distance Matrix) call presently; could be added.
- Nearby results limited to a small slice (default 8) for brevity.

Future SSR enhancements (optional):
- Add `traffic=1` support for ETA in traffic.
- Provide cluster distance summary for NearbyFood (already computed on API endpoint; could echo here without extra calls).
- Add `&format=json` to return a JSON payload for headless clients.

## Local Development
```bash
cd travel-time-webapp
npm install
cp .env.example .env # edit MAPS_API_KEY
export $(grep -v '^#' .env | xargs) # or use a dotenv tool
npm run dev
# Open: http://localhost:3000/tt?origin=Philadelphia,PA&destination=JFK%20Airport&mode=driving
```

## Public Base URL / ngrok Sharing
To generate QR codes that point to a publicly reachable domain (instead of `http://localhost:3000`) set an environment variable `PUBLIC_BASE_URL` before starting the server. This value is injected into the client and used for share QR deep links when the page is being viewed from `localhost`.

Example using ngrok:
```bash
# In one terminal run the app
export MAPS_API_KEY=YOUR_KEY
export PUBLIC_BASE_URL="https://your-subdomain.ngrok-free.app"  # no trailing slash
npm run dev

# In another terminal expose port 3000
ngrok http 3000
```
Then open (locally):
```
http://localhost:3000/tt?origin=Philadelphia,PA&destination=best%20italian%20restaurants%20near%20me&useProxy=true
```
The QR panel will encode the public URL, e.g.:
```
https://your-subdomain.ngrok-free.app/tt?origin=Philadelphia,PA&destination=best%20italian%20restaurants%20near%20me&useProxy=true&cuisine=italian
```
If `PUBLIC_BASE_URL` is not set, or you are not on localhost, the app uses `window.location.origin`.

Security note: ensure the public tunnel domain is trusted; do not expose secrets via query params.

## Running Tests & Lint
```bash
npm test
npm run lint
```

## Production Deployment (Node)
```bash
npm ci --omit=dev
MAPS_API_KEY=YOUR_KEY npm start
```

## Docker Build & Run
```bash
docker build -t travel-time-webapp:latest .
docker run -e MAPS_API_KEY=YOUR_KEY -p 3000:3000 travel-time-webapp:latest
```

## New Prototype Parameters & Features
- `qrThresholdMin` (default 10): minutes threshold above which QR code panel appears.
- `cuisine` (optional): forces NearbyFood intent and selects mock list (e.g. `&cuisine=italian`).
- Dual ETA display when traffic enabled (Base vs Traffic).
- `/metrics` endpoint: JSON counters for requests, rate limiting and API usage.
- Rate limiting: default 30 requests/min per IP for `/api/directions` & `/api/matrix` (override with `RATE_LIMIT_MAX`).

## Example Deep Links (Extended)
- Forced cuisine: `http://your-host/tt?origin=City,ST&destination=restaurants%20near%20me&cuisine=sushi&useProxy=true`
- Lower QR threshold: `http://your-host/tt?origin=City,ST&destination=JFK%20Airport&useProxy=true&qrThresholdMin=2`

## Error Handling
- Missing required params -> user-friendly message with usage hint.
- Invalid mode -> fallback to driving + warning.
- Google Maps API load failure -> show retry link.
- `/api/directions` endpoint: returns 400 (validation), 500 (internal / missing API key), 502 (provider error) with JSON body.

## Testing
`parseDeepLink` logic covered by Jest tests in `tests/params.test.js` plus server endpoint tests in `tests/server.test.js`.

## Next Steps / Enhancements
- Caching of frequent routes.
- Multi-segment routing.
- Live traffic refresh timer.
- Localization strings externalization.
- Accessibility improvements (screen reader labels, high contrast mode).
- Distance Matrix API for traffic-adjusted ETA.

## Security Notes
Never commit your real Google Maps API key. Use environment variables or secret management.

## Documentation
See `DOCS_DEEPLINK.md` for protocol details and planned extensions.

## Server API (Current)
- `GET /healthz` – basic health.
- `GET /api/directions?origin=...&destination=...&mode=driving&lang=en` – server proxy to Google Directions (phase 1). Returns simplified JSON. Enable via `useProxy=true`.
- `GET /api/matrix?origin=...&destination=...&mode=driving&lang=en` – Distance Matrix for distance & ETA (uses departure_time=now for driving). Use when `traffic=true`.
- `GET /api/food?origin=Philadelphia,PA&cuisine=italian` – new endpoint for real restaurant data using Google Places.

## Real Restaurant Data (Google Places)
NearbyFood intent now uses Google Places (Geocoding + Nearby Search) via `/api/food` when a valid `MAPS_API_KEY` is present.

Environment variables:
- `FOOD_SEARCH_RADIUS` (default 5000 meters)
- `FOOD_RESULTS_LIMIT` (default 10)
- `PLACES_TTL_MS` (cache TTL, default 300000 ms)

Endpoint:
```
GET /api/food?origin=Philadelphia,PA&cuisine=italian
Returns: { status, origin, cuisine, center:{lat,lng}, results:[ { name, rating, user_ratings_total, vicinity, location, open_now, price_level } ] }
```
Fallback:
- If missing key or API error and `mock=true` → returns mock dataset.
- Client falls back to mock list when Places fails.

Caching:
- LRU in-memory cache key: `food:{origin}:{cuisine}` with TTL.

## Mock Mode (No Google API Key)
You can run the app without a real `MAPS_API_KEY` using server mock responses.

Usage:
- Omit MAPS_API_KEY env var.
- Add `useProxy=true&mock=true` to deep link.

Example:
```
http://localhost:3000/tt?origin=Philadelphia,PA&destination=JFK%20Airport&useProxy=true&mock=true
```
Behavior:
- `/api/directions` and `/api/matrix` return static mock JSON (distance/duration/traffic ETA) when `mock=true` and server has no MAPS_API_KEY (or `MOCK_MODE=true`).
- UI shows a placeholder "Mock Map" instead of a real Google Map (no network call to Maps JS API).
- All other logic (QR threshold, intent detection, metrics, rate limit) functions normally.

To force mock even with a key defined, set `MOCK_MODE=true` env variable or include `mock=true` with an empty MAPS_API_KEY.

Limitations:
- No real geocoding or polyline.
- Distance/ETA are fixed values.

## Static Map Image Endpoints (Set‑Top Friendly)
To support environments where the interactive Google Maps JS cannot render (e.g. CSP restrictions / black screen issue on XRE), the server exposes helper endpoints that build a Google Static Maps URL for each intent. These return either JSON containing a `staticMapUrl` (default) or perform a redirect directly to the static image when `redirect=1` is supplied.

Base URL pattern:
```
GET /api/staticmap/{type}
```
Types implemented:
- `travel` – TravelTime intent (route polyline + start/end markers)
- `food` – NearbyFood intent (origin + numbered restaurant markers)
- `appointment` – AppointmentLeaveTime intent (route + depart status metadata)

Common query parameters:
- `origin` (required except food where only origin is required)
- `destination` (required for travel & appointment)
- `cuisine` (food only, optional)
- `mode` (optional; driving|walking|bicycling|transit; default driving)
- `apptTime` (ISO string; required for appointment)
- `bufferMin` (appointment; optional, default 10)
- `size` (WxH, default 1024x768; validated against simple regex)
- `limit` (food results markers 1–9; default 9, clamped)
- `mock=true` (force mock markers if no MAPS_API_KEY)
- `redirect=1` (302 redirect directly to the static image URL)

Example (TravelTime JSON):
```
GET /api/staticmap/travel?origin=Philadelphia,PA&destination=JFK%20Airport
Response:
{
  "status": "OK",
  "staticMapUrl": "https://maps.googleapis.com/maps/api/staticmap?size=1024x768&...&path=enc:...&key=...",
  "meta": {
    "origin": "Philadelphia,PA",
    "destination": "JFK Airport",
    "distance": { "text": "95 mi", "value": 152000 },
    "duration": { "text": "1 hour 45 mins", "value": 6300 },
    "start_address": "Philadelphia, PA, USA",
    "end_address": "JFK Airport, Queens, NY 11430, USA"
  }
}
```
Direct image (use in `XREImageResource`):
```
/api/staticmap/travel?origin=Philadelphia,PA&destination=JFK%20Airport&redirect=1
```

NearbyFood example:
```
/api/staticmap/food?origin=Philadelphia,PA&cuisine=italian&limit=6
```
Returns numbered red markers (1..N) plus origin marker (blue O). In mock mode (no key + `mock=true`) relative dummy offsets are used.

Appointment example (depart time computation included in meta):
```
/api/staticmap/appointment?origin=Philadelphia,PA&destination=Doctor%20Office&apptTime=2025-10-16T14:30:00-04:00&bufferMin=15
```
`meta` fields add `departBy` (ISO) and `status` (Future|LeaveNow|Late).

Implementation notes:
- Polyline added via `path=enc:...` only when Directions returns a route.
- When API key missing and no `mock=true`, returns 500 (to avoid accidental unauthenticated quota hits).
- `redirect=1` avoids exposing JSON metadata if device only needs the image.
- Size whitelist is basic (regex). Extend carefully to prevent abuse.
- Consider external caching / CDN if traffic grows; Static Maps URL itself is cacheable.

Set‑top usage snippet (pseudo‑Java):
```
String url = "https://your-host/api/staticmap/travel?origin=Philadelphia,PA&destination=JFK%20Airport&redirect=1";
child.setResource(r(new XREImageResource(app, url)));
```

Security / quota tips:
- Restrict Static Maps API usage to needed domains/IPs.
- Keep using proxy endpoints so the key is never in initial deep link.
- Add rate limiting if these endpoints become primary path (same pattern as /api/directions).

### Client-Side Static Map Mode (forceStatic)
For devices where the interactive Google Maps JS layer fails (black map area, CSP restrictions, missing WebGL), the client can be forced to skip loading the JS API and always show a server‑proxied Static Maps image.

Enable by adding either `static=1` or `forceStatic=1` to the deep link:
```
/tt?origin=Philadelphia,PA&destination=JFK%20Airport&mode=driving&useProxy=true&static=1
```
Behavior:
- Skips loading the Google Maps JavaScript API.
- Uses `/api/staticmap/travel/image` (or `food` / `appointment` variant) to fetch a PNG image sized to the container.
- Automatically falls back to static if interactive map load throws an error (no key, script blocked, etc.).
- NearbyFood intent always renders a static image now (simpler & more reliable for STB).

Appointment example (static forced):
```
/tt?origin=Philadelphia,PA&destination=Doctor%20Office&mode=driving&apptTime=2025-10-20T14:30:00-04:00&bufferMin=10&useProxy=true&forceStatic=1
```
NearbyFood example:
```
/tt?origin=Philadelphia,PA&destination=restaurants%20near%20me&cuisine=italian&useProxy=true&static=1
```
If `static=1` is omitted the app will attempt interactive mode first; on failure it still loads a static image (automatic fallback).

Image sizing: the client picks a size close to the rendered panel (`<=1280x1280`) to optimize clarity. Adjust by supplying your own `size` to the server image endpoints if embedding externally.

Performance considerations:
- Static images avoid heavy JS parsing & layout on constrained devices.
- Each image request is cached briefly (30s server in‑memory) to reduce duplicate fetches during quick navigation.
- Use `redirect=1` with JSON endpoints if embedding outside the main UI.

Security / key handling: forceStatic mode still never exposes the API key in the deep link; key remains server‑side.

---

## GitHub Usage & SSH (Quick Guide)
If you see `Permission denied (publickey)` or `Permission to sensey007/travel-time-webapp.git denied to ydmytr076_comcast` you are authenticating as the wrong GitHub user.

1. Generate an ed25519 key (already done). If you saved it as `private_key` in the project folder, move it into `~/.ssh` for consistency:
```bash
mv private_key private_key.pub ~/.ssh/
chmod 600 ~/.ssh/private_key
chmod 644 ~/.ssh/private_key.pub
```
2. Add public key to GitHub (logged in as `sensey007`):
```bash
pbcopy < ~/.ssh/private_key.pub  # copies key to clipboard
# GitHub > Settings > SSH and GPG keys > New SSH key > Paste clipboard
```
3. Create / edit `~/.ssh/config` to ensure this key is used:
```
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/private_key
  AddKeysToAgent yes
  IdentitiesOnly yes
```
4. Start agent & add key:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/private_key
```
5. Test auth:
```bash
ssh -T git@github.com
# Expect: Hi sensey007! You've successfully authenticated...
```
6. Set remote (inside repo):
```bash
git remote remove origin 2>/dev/null || true
git remote add origin git@github.com:sensey007/travel-time-webapp.git
git fetch origin
```
7. Commit & push:
```bash
git add .
git commit -m "Initial import with static map mode"
git push -u origin main
```
If using IntelliJ IDEA, switch GitHub account: `Settings/Preferences > Version Control > GitHub > - remove old account - Add account (Log In via Browser)` then retry push.

---
