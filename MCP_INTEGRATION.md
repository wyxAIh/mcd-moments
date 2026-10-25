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
- `GET /api/activity` — calls `campaign-calendar`; returns demo campaign data with `isDemo: true` if unavailable.
- `GET /api/nutrition` — calls `list-nutrition-foods`; returns a clearly marked demo fallback if unavailable.
- `POST /api/challenge` — accepts bounded JSON such as `{"city":"杭州","vibe":"focus","budget":"25-40","time":20,"partySize":1,"prefs":[]}` and returns three candidate seats. With a valid token it queries the selected city, reads a real menu, and calls `calculate-price` for each candidate; if a live store/menu cannot be resolved, it returns clearly marked demo candidates.

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

The challenge endpoint uses the official input rules: `query-nearby-stores` receives `beType=1`, `searchType=2`, city and keyword; `query-meals` receives the returned `storeCode`, `orderType=1`, `beType=1`; `calculate-price` receives the same store and product codes with `needTableware=false`. Prices returned by MCP are in fen and are converted to yuan only for display. The endpoint never invents live prices and reports demo candidates separately from any returned MCP source data.

## Client presentation contract

The browser UI is responsive across desktop, tablet, and mobile widths. It uses a local system font stack, rounded rectangular surfaces, touch-sized controls, visible focus states, and reduced-motion handling. These are presentation choices only: the browser never receives the MCP bearer token. The UI marks live responses as `LIVE DATA` and any fallback as `DEMO DATA`; a fallback must never be presented as an official price, menu, promotion, or nutrition result.

## Privacy and safety boundary

This service only makes read-only information calls. It does not access user accounts and does not create orders, place orders, or initiate payments. The request body only uses bounded, optional `goal` and `partySize` values for demo display; do not send sensitive personal data. Authorization is server-side and is never passed to browser code or returned in API responses. Demo content is explicitly labeled and is not official menu, nutrition, inventory, promotion, or pricing information.
