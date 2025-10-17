# Voice Route Lab Week Prototype Plan

## 1. Vision
Provide an immersive, voice‑first experience on X1 (XRE) that answers: "How long will it take me to get somewhere?", "What good places (restaurants) are nearby?", and (now experimental) "When should I leave for my scheduled appointment?" While delivering travel context, leverage screen time to surface cross‑device streaming continuity (QR code to continue watching on mobile / tune suggestions) during a waiting window.

## 2. Elevator Pitch
"Voice Route" turns the TV into a quick personal concierge for travel timing and nearby discovery, with smart follow‑ups and proactive prompts (future) about when to leave. While users evaluate route results, we unobtrusively promote relevant streaming continuity options.

## 3. Primary Personas
- Viewer Traveler: Wants quick ETA to airport or destination before leaving home.
- Food Explorer: Browsing dinner options nearby.
- Busy Parent / Professional: Has scheduled appointments and needs a leave‑time reminder (experimental in prototype).

## 4. Core Lab Week Scope (MVP Prototype)
IN scope:
1. Voice query → Deep link → Web app renders travel time (origin = approximate user location / default city) to a known destination (JFK, PHL, or a parsed airport name).
2. Restaurant discovery intent: detect intent + show list (mock or real Places if key permitted) with map markers.
3. UI shows ETA + optional traffic ETA (Directions + Distance Matrix proxy).
4. QR code widget to open the same intent in native Google Maps on mobile (search or directions) using proxy‑detected public base URL.
5. Logging of intent type and execution time; rate limiting and suspicious path detection.
6. AppointmentLeaveTime (experimental) – compute depart‑by time given appointment time, route duration, and buffer; show countdown & status (Future / LeaveNow / Late) in panel.

OUT of scope (lab week):
- Real user account integration / personalization.
- Calendar ingestion / reminders scheduling engine (we only compute once on page load + simple countdown).
- Push notifications / proactive alerts.
- Payment / booking flows.
- Full accessibility & localization (basic English only).

## 5. Future (Post‑Lab) Additions
- Robust appointment reminder engine + notifications.
- HMAC signed deep links + account context.
- Content recommendation model (choose best streaming suggestion vs static QR prompt).
- Waypoints + multi‑stop planning.
- Cached frequent destinations ("home", "work").
- Rich NearbyFood filters (price level, open now, rating thresholds).

## 6. Voice Intent Taxonomy (Current Prototype)
| Intent | Example Utterances | Slots / Entities | Implementation Status | Notes |
|--------|--------------------|------------------|-----------------------|-------|
| TravelTime | "How long does it take me to drive to JFK" / "ETA to PHL" | destination(airport/place), mode(optional), origin(optional) | Implemented | mode defaults to driving |
| NearbyFood | "Show me best Italian restaurants near me" / "Italian places nearby" | cuisine, radius(optional) | Implemented | Uses Places API if key; else mock list |
| AppointmentLeaveTime | "I have a doctor appointment at 11:30am in 1805 Deer Drive PA, when should I start" | destination(location/label + embedded time), apptTime(optional explicit ISO), buffer(optional), origin(optional) | Experimental (implemented) | Time can be auto‑parsed from destination if `apptTime` param omitted |
| ContinueWatchingPrompt (internal) | Not voice user triggered | content_context | Placeholder | QR suggestion logic stub |

### Slot Extraction Guidelines
- destination: match known airport codes (JFK/PHL) or treat phrase as free‑form Place query.
- cuisine: simple dictionary (italian, sushi, mexican, etc.).
- apptTime: ISO 8601 or RFC 3339 timestamp string (e.g. `2025-10-16T14:30:00-04:00`). (Voice layer must normalize before building deep link.)
- bufferMin: integer minutes (0–180) extra prep buffer.

## 7. Deep Link Mapping
| Intent | Deep Link (example) | Required Params (after auto‑parse) | Optional Params | Notes |
|--------|---------------------|------------------------------------|-----------------|-------|
| TravelTime | `/tt?origin=Philadelphia,PA&destination=JFK%20Airport&useProxy=true&traffic=true` | origin, destination | mode, traffic, refreshSec, lang | Map + route shown |
| NearbyFood | `/tt?origin=Philadelphia,PA&destination=italian%20restaurants%20near%20me&useProxy=true` | origin, destination | cuisine (also auto-detected), lang | Route suppressed; list + markers |
| AppointmentLeaveTime | `/tt?origin=Philadelphia,PA&destination=Doctor%20appointment%20at%2011:30am%20in%201805%20Deer%20Drive%20PA&bufferMin=10&intent=AppointmentLeaveTime` | origin, destination (time may be inside phrase) | apptTime (explicit ISO overrides parsed), bufferMin (default 10), mode, traffic, lang | If no `apptTime` param, server tries to parse time from destination text |

NOTES:
- `intent=AppointmentLeaveTime` may be omitted if time is parsed successfully from destination and phrase contains appointment keywords (doctor, dentist, meeting, appointment). Explicit `intent` is safer.
- NearbyFood: `destination` containing cuisine keywords triggers detection even without `intent` param.

## 8. Architecture (Prototype)
Textual Diagram:
Voice Input → NLU (intent + slots) → Deep Link Builder → XRE launches web container → Web App
    → (Directions Proxy / Matrix Proxy / Places) → Google APIs
    → UI Renderer (Map + Panels + QR) → User Interaction

## 9. External APIs Needed
| API | Purpose | Prototype Strategy |
|-----|---------|--------------------|
| Google Directions | Route polyline + duration | Implemented (/api/directions) |
| Google Distance Matrix | Traffic ETA | Implemented (/api/matrix) |
| Google Places | Nearby restaurants | Implemented with caching (/api/food) |

## 10. Data & Privacy Considerations
- Do not store raw user addresses beyond in‑memory processing.
- Logs hash origin/destination (prototype improvement over original note).
- API key restricted; do not expose directly (injected server‑side, proxied endpoints used by client).

## 11. Prototype Backlog (Updated)
| ID | Priority | Story | Acceptance Criteria | Status |
|----|----------|-------|---------------------|--------|
| TT-1 | P1 | As a user I ask travel time to JFK | ETA + distance shown within 2s, map centers route | Done |
| TT-2 | P1 | Show traffic‑adjusted ETA | Duration in traffic appears if available | Done |
| TT-3 | P1 | Log each intent resolution | JSON log line with intent, latency | Done |
| TT-4 | P1 | Display QR suggestion when wait >10m | QR block appears with mobile Maps link | Done (logic simplified) |
| NF-1 | P2 | Ask for Italian restaurants | List appears (mock or Places results) | Done |
| UX-1 | P2 | Handle invalid destination gracefully | Warning + usage message, no crash | Done |
| SEC-1 | P2 | Mask addresses in logs | Hashed tokens shown | Done |
| APPT-1 | P2 | Compute depart time for appointment | Panel shows depart-by + status | Experimental Done |

## 12. QR Suggestion Logic (Updated)
- For TravelTime & AppointmentLeaveTime intents, we render Google Maps deep link QR.
- For NearbyFood, QR is a Google Maps search for cuisine near origin.
- Future: add streaming continuity QR when wait window > threshold.

## 13. AppointmentLeaveTime Logic
Inputs (revised):
- `apptTime` (ISO) OR embedded time pattern inside `destination` (e.g. "at 11:30am", "11 30 am", "11am").
- `bufferMin` (minutes), route duration (sec), optional traffic duration.
Algorithm:
1. Determine appointment time: use `apptTime` param if present; else try auto‑parse from destination.
2. Fetch route (and traffic if `traffic=true`).
3. Effective travel duration (prefer traffic-adjusted).
4. `departTime = apptTime - travelDuration - bufferMin`.
5. Status rules: Late / LeaveNow / Future as before.
6. If auto‑parse failed and no explicit `apptTime`, endpoint returns 400.
Parsing Patterns Supported:
- `HH:MMam` / `HH:MM pm` (colon or dot) – examples: `11:30am`, `7.15 pm`.
- `HH MM am` (space separated) – example: `11 30 am`.
- `HHam` / `HH pm` – example: `9am`, `12 pm`.
Heuristics:
- If no am/pm and hour 1–7 and current hour already passed that time, treat as evening (add 12).
- If computed time already passed by >5 minutes today, roll to next day.
- Minutes default to `00` when absent (e.g. `11am` → 11:00).
Limitations:
- Does not parse relative phrases ("in 30 minutes").
- Does not parse timezone abbreviations ("EST").
- No support for words like "noon" / "midnight" yet.

## 14. Demo Script (Updated)
1. TravelTime to JFK.
2. NearbyFood (Italian) — list + markers & Google Maps QR.
3. AppointmentLeaveTime: Deep link with future appointment time to show depart-by + countdown.
4. Discuss potential streaming continuity & personalization.

## 15. Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|-----------|
| API quota exceed | Data unavailable | Cache + rate limiting + mock fallback |
| NLU mis-parses | Wrong intent | Explicit `intent` param override supported |
| Appointment times timezone mismatch | Incorrect depart time | Require ISO with timezone offset from voice layer |
| Key restriction issues | Feature disabled | SSR fallback + mock modes |

## 16. Roadmap Phases (Revised)
Phase 0 (Lab Week): TravelTime + NearbyFood + QR + experimental AppointmentLeaveTime.
Phase 1: Harden Places integration, improved appointment parsing, SSR polish.
Phase 2: Reminder service & notifications; secure signed links.
Phase 3: Streaming recommendation engine & user personalization.

## 17. Open Questions (Revisited)
1. Timezone handling: Should server derive user timezone vs trusting client / provided ISO?
2. Minimum accuracy required for depart time? (Currently single fetch; no re-poll).
3. Should appointment panel auto-refresh route every X minutes if far in future?
4. Extend NearbyFood to /food dedicated route for cleaner separation?
5. Add analytics to measure QR scans (server redirect endpoint)?

---
End of Lab Week Prototype Plan (Updated).

## 18. Static Map Image Fallback (Added Post Black‑Screen Issue)
To mitigate CSP / rendering limitations on some XRE devices (black screen when loading dynamic Maps JS), the prototype now exposes *image-first* endpoints that generate Google Static Maps URLs for each primary intent. These allow the set‑top application to display a single fetched image instead of executing client JS.

### Endpoints
| Intent | Endpoint | Required Params (after auto‑parse) | Optional Params | Notes |
|--------|----------|------------------------------------|-----------------|-------|
| TravelTime | `/api/staticmap/travel` | origin, destination | mode, size, mock, redirect | Adds polyline + A/B markers if Directions succeeds |
| NearbyFood | `/api/staticmap/food` | origin | cuisine, limit (1–9), size, mock, redirect | Numbered markers 1..N + origin (O) |
| AppointmentLeaveTime | `/api/staticmap/appointment` | origin, destination (time may be embedded) | apptTime, bufferMin, mode, size, mock, redirect | Auto‑parses time if `apptTime` missing; meta includes parsedFromDestination flag |

Common optional: `size` (e.g. 1024x768), `mock=true` (when no MAPS_API_KEY), `redirect=1` (302 redirect directly to image), `mode` (defaults driving where applicable).

### Response Forms
1. JSON (default): `{ status, staticMapUrl, meta{...} }` — consumer can decide how to display and optionally show textual metadata.
2. Redirect (`&redirect=1`): immediate HTTP 302 to static image URL (useful if platform only accepts direct image resource).

### Example Usage (Set‑Top Pseudo Code)
```
String img = "https://host/api/staticmap/travel?origin=Philadelphia,PA&destination=JFK%20Airport&redirect=1";
panel.setResource(r(new XREImageResource(app, img)));
```

### Appointment Metadata
`meta` for appointment includes: `distance`, `duration`, `departBy` (ISO), `status` (Future|LeaveNow|Late), allowing overlay text rendering without dynamic JS.

### Mock Behavior
If MAPS_API_KEY absent *and* `mock=true`: simplified markers (no real geocode) are emitted. Without key and no mock → 500 (explicit failure to prevent silent degraded UX).

### Rationale
- Fast fallback for demo readiness.
- Reduces client complexity / avoids CSP font/script rejects.
- Still leverages existing intent + proxy logic (Directions / Places) server‑side.

### Limitations & Future
- No interactive panning/zooming.
- Refresh requires a full new image request (could add `refreshSec` param for auto-reload pattern).
- Consider server-side caching of generated static URLs keyed by normalized (intent, params) to cut quota usage.
- Potential enhancement: composite annotation (ETA, depart status) rendered server-side into image (would require an image processing layer — out of scope now).

## 19. Backend Integration Utility (Java)
A helper class `VoiceRouteStaticMapUtil` (in `uicontainers` module, package `com.comcast.xre.containermanagement`) was added to parse XRE deep link parameters and build static map endpoint URLs for image-first fallback.

### Key Methods
- `parseDeepLink(String deepLinkUrl)`: Parses a full deep link (e.g. `xre:///guide/x2/voiceroute?searchType=nearbyFood&searchQuery=Italian%20places%20nearby&origin=Philadelphia,PA`) into normalized `IntentParams`.
- `parseParams(Map raw)`: Accepts a raw parameter map (non‑generic) and normalizes fields.
- `buildStaticMapEndpoint(IntentParams p, boolean redirect, boolean mock, String size)`: Returns relative endpoint path, e.g. `/api/staticmap/food?origin=Philadelphia%2CPA&cuisine=italian&limit=5&redirect=1`.
- `buildFullUrl(String baseUrl, IntentParams p, boolean redirect, boolean mock, String size)`: Prepends host.
- `detectCuisine(String phrase)`: Simple keyword detection fallback.

### IntentParams Fields
`type, origin, destination, cuisine, bufferMin, appointmentTime (Instant), mode, limit`.

### Example Usage (Backend Java)
```java
String deepLink = "xre:///guide/x2/voiceroute?searchType=nearbyFood&searchQuery=Italian%20places%20nearby&origin=Philadelphia,PA&limit=4";
VoiceRouteStaticMapUtil.IntentParams params = VoiceRouteStaticMapUtil.parseDeepLink(deepLink);
String relative = VoiceRouteStaticMapUtil.buildStaticMapEndpoint(params, true, false, "1024x768");
// relative -> /api/staticmap/food?origin=Philadelphia%2CPA&cuisine=italian&limit=4&size=1024x768&redirect=1
String full = VoiceRouteStaticMapUtil.buildFullUrl("https://demo.voice-route.example", params, true, false, "1024x768");
// full -> https://demo.voice-route.example/api/staticmap/food?... (ready for PanelView image resource)
```

### Notes
- NearbyFood `limit` sanitized to 1–9.
- Unsupported travel modes are stripped.
- Appointment `bufferMin` clamped to 0–180; `apptTime` expects ISO‑8601 (UTC Instant format) in prototype phase.
- When `searchType` missing, cuisine detection may infer `NearbyFood` intent from free‑form query.

## 20. Appointment Time Auto‑Parsing Details
The server attempts to extract an appointment time from the free‑form destination string when `apptTime` is not supplied.
Supported examples (all valid today):
- `Doctor appointment at 11:30am in ...`
- `Dentist visit 9am tomorrow` (parses 9am; ignores "tomorrow")
- `Meeting at 11 45 am` (space separated minutes)
- `Checkup 7pm` (converts 7pm → 19:00)
- `Lunch meeting at noon` (noon → 12:00; if already passed today, next day)
- `Conference call at midnight` (midnight → next upcoming 00:00)
- `Follow-up in 30 minutes` (relative → now + 30m)
- `Doctor check in 2 hours` (relative → now + 120m)
- `Bloodwork in 1h 15m` (relative multi-unit)
- `Prep in 90m` (relative minutes shorthand)
Parsing Order:
1. Keywords: noon, midnight.
2. Absolute clock times (HH:MM am/pm, HH MM am/pm, HHam/HHpm, bare HH heuristic).
3. Relative expressions starting with `in` (hours/minutes combinations).
Heuristics:
- Early bare hours (1–7) may be treated as afternoon if already passed this morning.
- Passed times (>5 min ago) roll to next day.
- Relative times compute from current moment; no day rollover logic needed.
- Midnight always resolves to next upcoming midnight (today if still before 00:05, else tomorrow).
Limitations:
- Ignores words like "tomorrow", "next Tuesday" for date shifting (future enhancement).
- Does not yet parse `noon thirty`, `quarter past`, natural language fractions.
- Timezone is local server time; no per-user zone adjustment.
- Relative phrases require the keyword `in` ("leave 30 minutes" not parsed).
Future Enhancements (post‑lab):
- Date keywords (tomorrow, next Monday) + timezone normalization.
- Natural language fractions ("half past", "quarter to").
- Support for `noon thirty` (12:30) and `midnight + 15m` style phrases.
- User locale / device timezone mapping.
