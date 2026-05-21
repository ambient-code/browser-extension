# Session Handoff — ACP Browser Extension

**Date:** 2026-05-20
**Session:** Built browser extension v2 from scratch, iterated through testing, pushed security fixes
**Branch:** main (no remote yet)

---

## Session Summary

### What Was Accomplished

1. **Archived old extension** → `/Users/jeder/repos/browser-extension-archived/`
2. **Built new extension from scratch** — 13 source files, ~3K lines, Chrome Manifest V3
   - OAuth PKCE auth (oauth.js) + manual token fallback
   - Centralized API client (api-client.js) targeting `/api/ambient/v1/`
   - Session list, chat, create session, workspace management (sidepanel.js)
   - Background polling + SSE event streaming + notifications (background.js)
   - Help chatbot with comprehensive ACP knowledge prompt (help-prompt.js)
   - Dark/light theme (light default)
3. **Iterative UI polish** — title bar with cluster name + versions, toolbar project switcher, inline confirmations, bigger fonts/icons
4. **Spec-driven development** — wrote `essence.md` and `spec.md` (Given/When/Then format matching platform specs)
5. **Security review** — manual review by two agents, fixed 5 issues
6. **Beads issue tracking** — 7 open issues
7. **Installed prodsec-skills plugin** — 138 security skills from RedHatProductSecurity/prodsec-skills

### What Was NOT Done

- **prodsec skills were installed but never invoked** — the plugin needed a session restart to register. Security review was done manually without the skills.
- **Chat streaming not fully tested** — SSE message streaming with a live running session hasn't been verified end-to-end (beads issue acp-ext-c4x)
- **GitHub repo not created yet** — old repo was deleted, new one needs `gh repo create`
- **OAuth flow doesn't work** — redirect URI not registered with Red Hat SSO (beads issue acp-ext-hnn)

---

## Files Modified (All New)

```
manifest.json        — Manifest V3, permissions: sidePanel, storage, identity, activeTab
oauth.js             — OIDC auth code + PKCE via chrome.identity.launchWebAuthFlow
api-client.js        — API client with resource namespaces + SSE parser
utils.js             — escHtml, timeAgo, getConfig, loadingDotsSVG, showToast
help-prompt.js       — Comprehensive ACP knowledge prompt for help chatbot
background.js        — Service worker: polling, SSE, notifications, badge
sidepanel.js         — Main UI: sessions, chat, wizard, settings, help panel
sidepanel.html       — Side panel HTML structure
popup.js             — Notification popup
popup.html           — Popup HTML
theme-init.js        — Theme sync before first paint
styles.css           — Dark-first CSS custom properties (light default)
essence.md           — Technology-agnostic description
spec.md              — Given/When/Then specification
scripts/update-help-prompt.sh — Regenerate help prompt from GitHub repos
CLAUDE.md            — Project documentation
```

---

## Current State

- **Repo:** `/Users/jeder/repos/browser-extension`
- **Branch:** main (17 commits, no remote)
- **Beads:** 7 open issues (prefix: acp-ext)
- **Plugin:** prodsec-skills installed at user level
- **No tests yet** — spec defines test strategy but no test files exist

---

## Next Steps (for next session)

### 1. Prodsec Security Review (PRIMARY TASK)

Verify prodsec-skills plugin is loaded, then run these skills against the codebase:

| Skill | Target Files |
|-------|-------------|
| `secure-token-handling` | oauth.js, api-client.js, sidepanel.js |
| `jwt-token-enforcement` | oauth.js, api-client.js |
| `oidc-integration` | oauth.js |
| `oauth21-implementation` | oauth.js |
| `authentication-enforcement` | api-client.js, background.js |
| `token-lifecycle` | oauth.js, sidepanel.js |
| `supply-chain-risk-auditor` | manifest.json, all JS files |
| `agentic-actions-auditor` | sidepanel.js (help chatbot), background.js |

Compare findings against security hardening commit `cb261a4` which already fixed:
- 401 retry forcing `oauthRefreshToken()` directly
- Help chatbot input framing with `[User Question]` delimiters
- SSE backoff jitter
- JWT exp extraction from manual tokens
- PII removal

Produce impact assessment: what did prodsec skills find that the manual review missed?

### 2. Create GitHub Repo + Push

```bash
gh repo create ambient-code/browser-extension --private --source . --push
```

### 3. Fix Chat Streaming (beads acp-ext-c4x)

Debug with fresh token + running session. Verify:
- POST /sessions/{id}/messages succeeds
- SSE at /sessions/{id}/messages?after_seq=N connects
- Events parse and render correctly

---

## Key Decisions Made

- **Fresh build, not refactor** — old API surface was too different to patch
- **No build step** — vanilla JS, importScripts, script tags
- **fetch + ReadableStream for SSE** — not EventSource (needs auth headers)
- **Manual token fallback** — OAuth redirect URI not registered with SSO yet
- **Light theme default** — user preference
- **Inline confirmations** — no browser confirm() dialogs
- **Help chatbot creates sessions on demand** — no persistent pods (~1000 projects)
- **User-Agent header** — `acp-browser-extension/{version}` on all requests

---

## Beads Issues

```
○ acp-ext-c4x  P1  Fix chat streaming - messages don't stream in real-time
○ acp-ext-hnn  P1  OAuth flow - register redirect URI with Red Hat SSO
○ acp-ext-93z  P2  Help chatbot - per-project help agent with optimistic UI
○ acp-ext-a18  P2  Update platform docs site with browser extension documentation
○ acp-ext-oow  P2  Session list - show last message preview (truncated)
○ acp-ext-q7x  P3  Server version display in header
○ acp-ext-uv8  P3  Native messaging host for auto-token
```

---

## Memory Files

Project memories at `~/.claude/projects/-Users-jeder-repos-browser-extension/memory/`:
- `acp-api-v1.md` — API endpoints, auth, response shapes
- `platform-repo-layout.md` — Where to find things in the platform monorepo
- `project-help-chatbot.md` — Help chatbot design decisions
- `feedback-use-chrome-devtools-mcp.md` — Use chrome-devtools MCP for live testing
