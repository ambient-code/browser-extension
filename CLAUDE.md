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


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
