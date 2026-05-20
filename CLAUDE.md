# ACP Browser Extension

Chrome extension (Manifest V3) for monitoring and interacting with Ambient Code Platform agentic sessions.

## Stack

- Vanilla JS (no framework, no build step)
- Chrome Extensions API (Manifest V3)
- SSE via fetch + ReadableStream (not EventSource — supports auth headers)
- CSS custom properties for theming (dark/light)
- Red Hat SSO OIDC (authorization code + PKCE) for authentication

## Structure

- `manifest.json` — Extension manifest (permissions: sidePanel, storage, identity)
- `oauth.js` — OIDC auth code + PKCE flow via chrome.identity.launchWebAuthFlow
- `api-client.js` — Centralized API client with resource namespaces (sessions, projects)
- `utils.js` — Shared helpers (escHtml, timeAgo, getConfig, loadingDotsSVG, showToast)
- `background.js` — Service worker: polling, SSE event streaming, notifications, badge
- `sidepanel.js` — Main UI: session list, chat view, create session, settings, wizard
- `popup.js` — Notification popup (3 most recent)
- `theme-init.js` — Sync theme application before first paint
- `styles.css` — All styles (dark-first, CSS custom properties)

## Key Patterns

- No ES modules — service worker uses `importScripts()`, HTML pages use `<script>` tags
- Config stored in `chrome.storage.local`: baseUrl, projectName, oauthTokens, theme
- Every API request requires `Authorization: Bearer {jwt}` + `X-Ambient-Project: {projectName}`
- All API endpoints under `/api/ambient/v1/`
- Session identity by `id` (opaque string), `name` for display
- SSE parsing via fetch + ReadableStream (parseSSEStream helper in api-client.js)
- All DOM text insertion uses `escHtml()` to prevent XSS
- Adaptive polling: 15s normal, 3s during transitional phases

## ACP API v1 Endpoints

Base: `{baseUrl}/api/ambient/v1`

- `GET /sessions?page=&size=` — List sessions
- `POST /sessions` — Create session
- `POST /sessions/{id}/start` | `POST /sessions/{id}/stop` — Lifecycle
- `GET /sessions/{id}/messages?after_seq=N` — List messages (JSON) or SSE stream
- `POST /sessions/{id}/messages` — Send message `{ event_type: "user", payload: "..." }`
- `GET /sessions/{id}/events` — Raw AG-UI event stream (SSE)
- `GET /projects` | `POST /projects` | `DELETE /projects/{id}` — Workspace CRUD

## Authentication

OIDC authorization code + PKCE via Red Hat SSO:
- Issuer: `https://sso.redhat.com/auth/realms/redhat-external`
- Client ID: `ocm-cli`
- Flow: chrome.identity.launchWebAuthFlow → code exchange → JWT stored in chrome.storage.local
- Auto-refresh before expiry, AUTH_EXPIRED broadcast on failure

## Development

Load as unpacked extension in `chrome://extensions` with Developer mode enabled. No build step required — edit files and reload the extension.

Use `chrome-devtools` MCP server (configured in user settings) for live browser testing during development.
