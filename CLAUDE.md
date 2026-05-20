# ACP Browser Extension

Chrome extension (Manifest V3) for monitoring and interacting with Ambient Code Platform agentic sessions.

## Stack

- Vanilla JS (no framework, no build step, no ES modules)
- Chrome Extensions API (Manifest V3)
- SSE via fetch + ReadableStream (not EventSource — supports auth headers)
- CSS custom properties for theming (dark/light, light default)
- Red Hat SSO OIDC (authorization code + PKCE) for authentication

## Structure

- `manifest.json` — Extension manifest (permissions: sidePanel, storage, identity, activeTab)
- `oauth.js` — OIDC auth code + PKCE flow via chrome.identity.launchWebAuthFlow
- `api-client.js` — Centralized API client with resource namespaces + SSE parser
- `utils.js` — Shared helpers (escHtml, timeAgo, getConfig, loadingDotsSVG, showToast)
- `help-prompt.js` — Comprehensive ACP knowledge prompt for help chatbot sessions
- `background.js` — Service worker: polling, SSE event streaming, notifications, badge, action click
- `sidepanel.js` — Main UI: session list, chat, create session, settings, wizard, help panel, project switcher
- `popup.js` — Notification popup (3 most recent)
- `theme-init.js` — Sync theme before first paint
- `styles.css` — All styles (CSS custom properties, dark-first with light default)
- `essence.md` — Technology-agnostic description of what the extension does
- `spec.md` — Given/When/Then specification (platform spec format)

## Development

Load as unpacked extension in `chrome://extensions` with Developer mode enabled. No build step — edit files and reload.

### Reload after code changes
1. Go to `chrome://extensions`
2. Click the reload icon on the ACP extension
3. Close and reopen the side panel

### Get a fresh token (tokens expire in ~5 minutes)
```bash
acpctl login --use-auth-code --url <server-url>
python3 -c "import json; print(json.load(open('$HOME/Library/Application Support/ambient/config.json'))['access_token'])" | pbcopy
```
Paste into the extension's token field.

### Debug
- **Side panel DevTools**: Right-click the side panel → Inspect
- **Service worker DevTools**: `chrome://extensions` → "service worker" link under the extension
- Check service worker console for polling/SSE errors and Network tab for API call failures

Use `chrome-devtools` MCP server (configured in user settings) for live browser testing.

## API Contract

Base: `{baseUrl}/api/ambient/v1`

Every request requires: `Authorization: Bearer {jwt}` + `X-Ambient-Project: {projectName}`

- Sessions: `GET/POST /sessions`, `POST /sessions/{id}/start|stop`, `DELETE /sessions/{id}`
- Messages: `GET/POST /sessions/{id}/messages` (REST), `GET /sessions/{id}/messages?after_seq=N` with `Accept: text/event-stream` (SSE)
- Events: `GET /sessions/{id}/events` with `Accept: text/event-stream` (raw AG-UI stream)
- Projects: `GET/POST /projects`, `PATCH/DELETE /projects/{id}`

List responses wrapped as `{ kind, page, size, total, items: [...] }`.

## Key Patterns

- Service worker uses `importScripts()`, no ES modules
- All DOM text insertion uses `escHtml()` for XSS prevention
- SSE via fetch + ReadableStream with manual line parsing (parseSSEStream in api-client.js)
- Overlay panels use `.overlay-panel.active` class toggle via showPanel()/hidePanel()
- Inline confirmation for destructive actions (Stop/Delete → Confirm?/No button pair, no browser dialogs)
- Adaptive polling: 15s normal, 3s during transitional phases (Creating, Pending, Stopping)
- Token auto-refresh 60s before expiry; AUTH_EXPIRED broadcast stops all activity on failure
- SSE reconnect uses exponential backoff (1s→30s max), stops entirely on auth errors
- Concurrent poll execution guarded with mutex flag
- Session updates only broadcast when data actually changed (JSON comparison)

## Gotchas

- JWTs from Red Hat SSO expire in ~5 minutes. Manual token paste sets a fake 24h expiry.
- OAuth `chrome.identity.launchWebAuthFlow` requires the redirect URI registered with SSO. Currently not registered for `ocm-cli` client — OAuth flow fails, manual token paste is the workaround.
- `escHtml()` has a regex fallback for service worker context where `document` is undefined.
- CSP blocks inline SVG data URIs unless `img-src 'self' data:` is in the manifest CSP.
- Service worker can be killed by Chrome at any time — timers and SSE connections are not persistent.
- `chrome.runtime.sendMessage` throws if no listener exists — always wrap in try/catch via `broadcast()`.
- The `X-Ambient-Project` header is required on all API calls (discovered from SDK source, not documented in API spec).

## Issue Tracking

This project uses **bd (beads)** for issue tracking. Run `bd list` to see open issues, `bd ready` for available work.

## Spec-Driven Development

- `essence.md` — What the extension is and does (technology-agnostic)
- `spec.md` — Rebuildable specification with Given/When/Then scenarios
