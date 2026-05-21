# ACP Browser Extension — Essence

> Extracted from the browser-extension repository on 2026-05-20. This document describes what the software is and does, independent of its current implementation.

## 1. Purpose

A Chrome browser extension that provides a persistent side panel for monitoring and interacting with Ambient Code Platform (ACP) agentic sessions. Power users — PMs, data scientists, ops engineers — use it to manage AI agent sessions across multiple workspaces without switching to the full web UI. The extension provides real-time session monitoring, chat interaction with running agents, workspace management, and push notifications for session events.

## 2. User Journeys

### Journey: First-Time Setup
1. User clicks the extension icon → side panel opens
2. Extension detects no stored credentials → shows setup wizard
3. User enters the ACP server URL
4. User authenticates via Red Hat SSO (OAuth PKCE) or pastes an access token manually
5. Extension validates credentials against the API
6. User selects a workspace (project) from a dropdown, or creates a new one
7. Extension loads the session list for that workspace

### Journey: Monitor Sessions
1. User opens the side panel → sees session list for the active workspace
2. Each session shows: name, phase badge (Running/Stopped/Failed/etc.), model, age, and prompt preview
3. Extension polls for updates every 15 seconds (3 seconds during transitions)
4. Phase changes update the list in real-time
5. User can switch workspaces from the toolbar dropdown without going to settings

### Journey: Chat with a Running Session
1. User clicks a running session (or clicks the Chat button)
2. Chat panel opens as an overlay → loads message history via REST API
3. Extension connects an SSE stream for real-time message delivery
4. User types a message → it appears immediately in the chat → assistant response streams in via SSE
5. Tool calls and results are displayed inline
6. Human-in-the-loop questions render as interactive options
7. User clicks back arrow → returns to session list, SSE disconnects

### Journey: Create a Session
1. User clicks the "+" button in the toolbar
2. Create session panel opens with fields: name, initial prompt, repository URL (with autocomplete from history), model (dropdown)
3. User fills in the form and clicks Create
4. Extension creates the session via API → shows success toast → refreshes list

### Journey: Manage Session Lifecycle
1. User clicks Stop on a running session → inline confirmation (Stop? / No) → session stops
2. User clicks Start on a stopped session → session starts, fast polling begins
3. User clicks Delete on a stopped session → inline confirmation (Delete? / No) → session deleted

### Journey: Get Help
1. User clicks the "?" button in the title bar
2. Help panel opens with a chat interface and resource links
3. User asks a question → extension creates a help session with a comprehensive ACP knowledge prompt
4. Messages buffer during session startup → send when ready
5. Assistant response streams back via SSE

### Journey: Receive Notifications
1. Background worker monitors running sessions via SSE event streams
2. When an agent needs input (AskUserQuestion), finishes a run, or encounters an error → notification created
3. Badge count appears on the extension icon
4. Clicking the extension icon opens the side panel (single-click toggle)
5. Notifications stored locally (up to 50), markable as read

### Journey: Auth Expiry Recovery
1. Token expires → API returns 401
2. Extension broadcasts AUTH_EXPIRED → stops all polling and SSE connections
3. Side panel shows "Session expired" toast → resets to wizard login step
4. User re-authenticates → workspace and sessions reload

## 3. Functional Requirements

### Authentication
- The extension SHALL support OIDC authorization code flow with PKCE via Red Hat SSO
- The extension SHALL support manual token paste as a fallback authentication method
- Tokens SHALL be stored in chrome.storage.local with expiry tracking
- The extension SHALL auto-refresh access tokens before expiry using the refresh token
- When refresh fails, the extension SHALL clear stored tokens and show the login wizard
- Manual tokens SHALL be validated against the API before proceeding to workspace selection

### API Communication
- All API requests SHALL include `Authorization: Bearer {token}` and `X-Ambient-Project: {project}` headers
- All endpoints SHALL use the base path `/api/ambient/v1/`
- On 401 response, the extension SHALL attempt one token refresh and retry before declaring auth expired
- SSE streams SHALL use fetch + ReadableStream (not EventSource) to support custom auth headers
- SSE reconnection SHALL use exponential backoff (1s → 2s → 4s → ... → 30s max)
- SSE connections SHALL stop entirely on authentication errors (no reconnect loop)

### Session Management
- The extension SHALL list sessions for the active workspace with pagination
- Sessions SHALL display: name, phase, model, creation time, and prompt preview
- The extension SHALL support creating sessions with: name, prompt, repository URL, and model selection
- The extension SHALL support starting, stopping, and deleting sessions
- Destructive actions (stop, delete) SHALL require inline confirmation (action button → confirm/cancel pair)
- Repository URL input SHALL offer autocomplete from previously entered values
- Model selection SHALL use a dropdown with supported model options

### Chat
- Message history SHALL load via REST API (`GET /sessions/{id}/messages`)
- Live messages SHALL stream via SSE (`GET /sessions/{id}/messages?after_seq=N`)
- The extension SHALL render message types: user, assistant, tool_use, tool_result, error, system
- Sent messages SHALL appear immediately (optimistic rendering)
- The chat input SHALL remain fixed at the bottom of the panel
- Auto-scroll SHALL activate only when the user is near the bottom of the chat

### Workspace Management
- The extension SHALL list available workspaces from the API
- Users SHALL be able to switch workspaces from the toolbar (not buried in settings)
- The extension SHALL support creating and deleting workspaces
- The active workspace name SHALL be visible in the toolbar

### Polling and Real-Time Updates
- Normal polling interval: 15 seconds
- Fast polling interval: 3 seconds (during transitional phases: Creating, Pending, Stopping)
- Fast polling SHALL revert to normal after 30 seconds
- The extension SHALL only broadcast session updates when data has actually changed
- Concurrent poll execution SHALL be prevented with a guard flag
- The background worker SHALL connect SSE event streams for sessions in Running or Creating phase

### Notifications
- The extension SHALL create notifications for: input needed (AskUserQuestion), run finished, run error
- Notifications SHALL be stored in chrome.storage.local, capped at 50
- Unread count SHALL display on the extension badge
- Users SHALL be able to mark all notifications as read

### UI/UX
- Title bar SHALL show: connection status dot (green/yellow/red/gray), cluster name, server version, extension version
- Cluster name SHALL be extracted from the server URL (e.g., "vteam-uat" from ROSA URL pattern)
- Clicking the cluster name SHALL copy the full server URL to clipboard
- Clicking the extension version SHALL open the GitHub repository
- Dark and light themes SHALL be supported via CSS custom properties
- Light theme SHALL be the default
- Theme selection SHALL persist across sessions
- Setup wizard SHALL provide back/reset buttons on both steps to escape stuck states
- Toast notifications SHALL support types: info (blue), success (green), error (red), warning (yellow)

### Help Chatbot
- The extension SHALL provide a help panel accessible via "?" button
- On first question, the extension SHALL create a help session with a comprehensive ACP knowledge prompt
- Messages SHALL buffer during session startup and send when ready
- The help panel SHALL include static resource links (documentation, issues, community)

## 4. Data Model

### OAuthTokens (chrome.storage.local)
- access_token: string — JWT bearer token
- refresh_token: string|null — for auto-refresh
- expires_at: number — Unix timestamp (ms) of token expiry
- issuer_url: string|null — OIDC issuer URL

### Config (chrome.storage.local)
- baseUrl: string — ACP server URL
- projectName: string — active workspace name
- theme: 'dark'|'light' — UI theme preference

### Session (from API)
- id: string — opaque identifier
- name: string — display name
- phase: string — Pending|Creating|Running|Stopping|Stopped|Completed|Failed
- project_id: string — workspace identifier
- agent_id: string — agent identifier
- llm_model: string — model name (e.g., claude-sonnet-4-6)
- prompt: string — initial prompt text
- repo_url: string — attached repository
- created_at: string — ISO timestamp
- updated_at: string — ISO timestamp
- kind: string — always "Session"
- href: string — API resource path

### SessionMessage (from API)
- id: string — message identifier
- session_id: string — parent session
- seq: number — monotonic sequence number within session
- event_type: string — user|assistant|tool_use|tool_result|system|error
- payload: string — message body (plain text or JSON)
- created_at: string — ISO timestamp

### Project (from API)
- id: string — project identifier
- name: string — project name (used as workspace identifier)
- displayName: string — human-readable name
- description: string — optional description

### Notification (local)
- id: number — timestamp when created
- read: boolean — read state
- ts: string — ISO timestamp
- sessionId: string — related session
- kind: 'input_needed'|'run_finished'|'error' — notification type
- title: string — notification title
- body: string — notification body

### History (chrome.storage.local)
- urlHistory: string[] — previously used server URLs (max 10)
- repoHistory: string[] — previously used repository URLs (max 20)

## 5. External Interfaces

- **ACP API v1**: REST + SSE at `/api/ambient/v1/` — sessions CRUD, messages, projects, events. Auth via Bearer JWT + X-Ambient-Project header.
- **Red Hat SSO**: OIDC provider at `sso.redhat.com/auth/realms/redhat-external` — authorization code + PKCE flow, token exchange, refresh. Client ID: `ocm-cli`.
- **Chrome Extensions API**: storage.local, identity (launchWebAuthFlow), sidePanel, action (badge, onClicked), runtime (messaging between service worker and UI pages).

## 6. Tech Stack

- **Language**: JavaScript (ES2020+, no modules)
- **Platform**: Chrome Extensions API (Manifest V3)
- **UI**: Vanilla DOM manipulation, CSS custom properties for theming
- **Build**: None — no bundler, transpiler, or build step
- **Storage**: chrome.storage.local
- **Networking**: fetch API, ReadableStream for SSE parsing

## 7. UX Patterns

- **Layout**: Chrome side panel (~400px wide), full-height flex column
- **Navigation**: Overlay panels (chat, create, settings, help) slide over the session list. Back button returns to list.
- **Title bar**: Persistent bar showing connection status, cluster name, versions. Separated from the toolbar.
- **Toolbar**: "Sessions" label + project dropdown + action buttons (refresh, create, settings)
- **Session list**: Scrollable list with per-session action buttons (Chat, Stop, Start, Delete)
- **Inline confirmation**: Destructive actions replace the action button with Confirm/Cancel pair (no browser dialogs)
- **Toasts**: Top-right floating notifications, auto-dismiss after 4 seconds
- **Theme**: CSS custom properties on `:root` (dark) and `[data-theme="light"]` (light)
- **Wizard**: Two-step setup flow with step indicators, back/reset buttons on both steps

## 8. Known Gaps

- **OAuth redirect URI not registered**: Red Hat SSO's `ocm-cli` client doesn't accept the chrome-extension redirect URI, so OAuth flow fails. Manual token paste is the workaround.
- **Chat streaming not verified end-to-end**: SSE connection for live chat messages hasn't been fully tested with a real running session + fresh token.
- **Server version display**: Shows "server:unknown" because no API version endpoint exists.
- **No token auto-refresh in manual mode**: Manually pasted tokens have a fake 24h expiry and no refresh token, so they expire without recovery.
- **Create session doesn't auto-start**: Creating a session sets the prompt but doesn't start execution. User must click Start separately.
- **Help chatbot cold start**: Help session takes ~10 seconds to start. Optimistic UI buffers messages, but user sees delay.
