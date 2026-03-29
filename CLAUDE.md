# ACP Browser Extension

Chrome extension (Manifest V3) for monitoring and interacting with Ambient Code Platform agentic sessions.

## Stack

- Vanilla JS (no framework, no build step)
- Chrome Extensions API (Manifest V3)
- SSE (Server-Sent Events) for real-time streaming
- CSS custom properties for theming (dark/light)

## Structure

- `manifest.json` — Extension manifest (permissions, service worker, side panel)
- `background.js` — Service worker: SSE subscriptions, polling, notifications, badge
- `sidepanel.js` — Main UI: session list, chat view, create session, settings
- `popup.js` — Notification popup (3 most recent)
- `utils.js` — Shared helpers (`escHtml`, `timeAgo`, `getConfig`, `loadingDotsSVG`)
- `theme-init.js` — Sync theme application before first paint
- `styles.css` — All styles (dark-first, CSS custom properties)

## Key Patterns

- No ES modules — service worker uses `importScripts('utils.js')`, HTML pages use `<script>` tags
- Config (baseUrl, apiKey, projectName) stored in `chrome.storage.local`, read via `getConfig()` in `utils.js`
- Adaptive polling: 15s normal, 3s during transitional phases (Creating, Pending, Stopping)
- SSE connections managed per-session in background.js via fetch + ReadableStream (not EventSource)
- Chat view uses EventSource with token as query param (no custom headers supported)
- All DOM text insertion uses `escHtml()` to prevent XSS

## ACP API Endpoints

Base: `{baseUrl}/api/projects/{projectName}/agentic-sessions`

- `GET ?limit=100` — List sessions
- `POST` — Create session
- `POST /{name}/start` | `POST /{name}/stop` — Lifecycle
- `POST /{name}/agui/run` — Send message (returns SSE stream)
- `GET /{name}/agui/events` — Subscribe to session events (SSE)

## Development

Load as unpacked extension in `chrome://extensions` with Developer mode enabled. No build step required — edit files and reload the extension.

## Active Technologies
- JavaScript (ES2020+, no modules) + Chrome Extensions API (Manifest V3), no external libraries (001-workspace-management)
- `chrome.storage.local` for config persistence (001-workspace-management)

## Recent Changes
- 001-workspace-management: Added JavaScript (ES2020+, no modules) + Chrome Extensions API (Manifest V3), no external libraries
