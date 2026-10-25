# McDonald's MCP proxy integration

## Runtime and dependencies

- Node.js 18 or later (built-in `fetch`, HTTP, HTTPS, filesystem modules)
- No third-party npm packages
- Start: `node server.js` (or `npm start`)
- Syntax check: `node --check server.js`

Set variables in the shell/process manager before startup. `.env.example` is a template only; this server deliberately does not parse `.env` files and does not store credentials.

```sh
MCD_MCP_TOKEN='<your_token>' node server.js
```

The actual token must be supplied through the environment, never committed into source, logs, or frontend files. `MCD_MCP_URL` defaults to `https://mcp.mcd.cn`; non-HTTPS endpoints are rejected except localhost for isolated testing. Configure `PORT` and optionally `HOST` as needed.

## HTTP interface

- `GET /api/health` — service status and whether MCP is configured.
- `GET /api/activity` — calls `campaign-calendar`; missing token returns HTTP 503 and failed/empty MCP result returns HTTP 502. No demo fallback is used.
- `GET /api/nutrition` — calls `list-nutrition-foods`; missing token returns HTTP 503 and failed/empty MCP result returns HTTP 502. No demo fallback is used.
- `POST /api/challenge` — accepts bounded JSON such as `{"city":"杭州","vibe":"focus","budget":"25-40","time":20,"partySize":1,"prefs":[]}` and returns three candidate seats only after a valid MCP token, live store, live menu and a numeric `calculate-price` result for every seat are available. If any live prerequisite fails, it returns an explicit 4xx/5xx error and does not substitute fixed demo candidates.

All API responses are JSON. CORS preflight is supported. The process also serves static assets from this directory (`/` serves `index.html` when present).

## MCP calls

The proxy sends Streamable HTTP JSON-RPC POST requests with `Accept: application/json, text/event-stream`, `Authorization: Bearer ${MCD_MCP_TOKEN}`, and `method: "tools/call"`. Tool calls use `params.name` and `params.arguments`.

Tool names used:

- `campaign-calendar`
- `list-nutrition-foods`
- `query-nearby-stores`
- `query-meals`
- `query-meal-detail`
- `calculate-price`

The challenge endpoint uses the official input rules: `query-nearby-stores` receives `beType=1`, `searchType=2`, city and keyword; `query-meals` receives the returned `storeCode`, `orderType=1`, `beType=1`; `calculate-price` receives the same store and product codes with `needTableware=false`. `query-meals.currentPrice` is treated as a menu reference amount in yuan, while `calculate-price.price`, `originalPrice`, and `discount` are required to be integer fen and are converted to yuan only for display. The endpoint also verifies that `calculate-price.productList` matches the submitted product codes and quantities, and rejects any candidate above the selected per-person budget. The endpoint never invents live prices. The public UI shows an explicit error when live data is unavailable; demo content is not used as an official live output.

## Client presentation contract

The browser UI is responsive across desktop, tablet, and mobile widths. It uses a local system font stack, rounded rectangular surfaces, touch-sized controls, visible focus states, and reduced-motion handling. These are presentation choices only: the browser never receives the MCP bearer token. The UI marks validated responses as `LIVE DATA`; a missing token, failed MCP call, incomplete live menu, or missing computed price is shown as an error, not as a prefilled demo recommendation. Local fixtures must never be presented as an official price, menu, promotion, or nutrition result.

## Privacy and safety boundary

This service only makes read-only information calls. It does not access user accounts and does not create orders, place orders, or initiate payments. The request body uses bounded city, scenario, budget, available time, party size and preference values; do not send sensitive personal data. Scenario, budget, time, party size and preferences shape menu matching, product quantities, per-person price context, candidate titles and reasons. Time is a planning context only; it is not a promise of preparation or queue duration. Authorization is server-side and is never passed to browser code or returned in API responses. The service is read-only and never creates orders or initiates payments.
