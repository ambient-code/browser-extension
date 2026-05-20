# ACP Browser Extension Specification

**Date:** 2026-05-20
**Status:** Active
**Related:**
  - `../platform/components/ambient-api-server/openapi/` — API contract
  - `../platform/components/ambient-cli/cmd/acpctl/login/authcode.go` — OAuth reference implementation

---

## Purpose

Chrome browser extension (Manifest V3) that provides a persistent side panel for monitoring and interacting with Ambient Code Platform agentic sessions. Targets power users (PMs, data scientists, ops engineers) who need session visibility and chat access without the full web UI.

The extension connects to the ACP API v1 (`/api/ambient/v1/`), authenticates via Red Hat SSO OIDC with PKCE, and provides: session list with lifecycle controls, real-time chat with streaming, workspace management, push notifications, and an in-extension help chatbot.

No build step. No framework. Vanilla JS with Chrome Extensions APIs.

---

## Authentication Contract

### Requirement: OIDC Authorization Code Flow with PKCE

The extension SHALL authenticate users via the OIDC authorization code flow with PKCE, using `chrome.identity.launchWebAuthFlow` to handle the browser redirect.

| Parameter | Value |
|-----------|-------|
| Issuer | `https://sso.redhat.com/auth/realms/redhat-external` (configurable) |
| Client ID | `ocm-cli` |
| Grant type | `authorization_code` |
| PKCE method | S256 |
| Redirect URI | `chrome.identity.getRedirectURL()` |

#### Scenario: Successful OAuth login

- GIVEN the user has entered a valid server URL
- WHEN the user clicks "Login with Red Hat SSO"
- THEN the extension opens the SSO login page via `launchWebAuthFlow`
- AND exchanges the authorization code for tokens
- AND stores `access_token`, `refresh_token`, and `expires_at` in chrome.storage.local
- AND proceeds to workspace selection

#### Scenario: OAuth login cancelled

- GIVEN the SSO login popup is open
- WHEN the user closes the popup without completing login
- THEN the extension shows an error message on the wizard
- AND no tokens are stored

### Requirement: Manual Token Fallback

The extension SHALL support manual token paste as an alternative to OAuth when the redirect URI is not registered with the SSO provider.

#### Scenario: Manual token accepted

- GIVEN the user has entered a server URL and pasted a token
- WHEN the user clicks "Use Token"
- THEN the extension validates the token by calling `GET /api/ambient/v1/projects`
- AND on success, stores the token with a 24-hour expiry
- AND proceeds to workspace selection

#### Scenario: Manual token rejected

- GIVEN the user has pasted an invalid or expired token
- WHEN the extension validates against the API
- THEN the API returns 401
- AND the extension clears the stored token
- AND shows "Token rejected by server" error

### Requirement: Token Auto-Refresh

The extension SHALL refresh access tokens before expiry using the stored refresh token.

#### Scenario: Token nearing expiry

- GIVEN a stored token with less than 60 seconds until expiry
- AND a valid refresh token exists
- WHEN any API request is made
- THEN the extension refreshes the token before making the request
- AND updates stored tokens with new values

#### Scenario: Refresh token expired

- GIVEN a stored refresh token that the SSO server rejects
- WHEN a refresh is attempted
- THEN the extension clears all stored tokens
- AND broadcasts `AUTH_EXPIRED` to all extension pages
- AND stops all polling and SSE connections
- AND the side panel shows the login wizard

---

## API Communication Contract

### Requirement: Request Headers

Every API request SHALL include:

| Header | Value | Required |
|--------|-------|----------|
| `Authorization` | `Bearer {access_token}` | Always |
| `X-Ambient-Project` | `{project_name}` | Always (may be empty during setup) |
| `User-Agent` | `acp-browser-extension/{version}` | Always |
| `Content-Type` | `application/json` | On POST/PATCH/PUT |
| `Accept` | `application/json` or `text/event-stream` | Always |

### Requirement: 401 Retry

On receiving a 401 response, the extension SHALL attempt one token refresh and retry the request. If the retry also returns 401, the extension SHALL broadcast `AUTH_EXPIRED` and stop all background activity.

#### Scenario: Transient 401 recovered by refresh

- GIVEN a valid refresh token
- WHEN an API request returns 401
- THEN the extension refreshes the token
- AND retries the request with the new token
- AND the request succeeds

#### Scenario: Persistent 401 triggers auth expiry

- GIVEN no valid refresh token (or refresh fails)
- WHEN an API request returns 401
- AND the retry also returns 401
- THEN the extension broadcasts `AUTH_EXPIRED`
- AND stops polling and all SSE connections
- AND the side panel shows the login wizard

### Requirement: SSE Streaming

All SSE connections SHALL use `fetch` + `ReadableStream` (not `EventSource`) to support custom authorization headers.

SSE reconnection SHALL use exponential backoff: 1s → 2s → 4s → ... → 30s max. Backoff SHALL reset on successful connection. SSE connections SHALL NOT reconnect on authentication errors.

#### Scenario: SSE reconnects after network error

- GIVEN an active SSE connection to a running session
- WHEN the connection drops due to a network error
- THEN the extension schedules a reconnection with exponential backoff
- AND resumes from the last known sequence number

#### Scenario: SSE stops on auth error

- GIVEN an SSE connection attempt fails with 401
- THEN the extension does NOT schedule a reconnection
- AND stops all polling and SSE connections

---

## Session Management

### Requirement: Session List

The extension SHALL poll `GET /api/ambient/v1/sessions?size=100` at regular intervals and display sessions for the active workspace.

| Interval | Condition |
|----------|-----------|
| 15 seconds | All sessions in stable phases |
| 3 seconds | Any session in Creating, Pending, or Stopping phase |

The extension SHALL only broadcast `SESSIONS_UPDATED` when session data has actually changed (comparison guard).

Concurrent poll execution SHALL be prevented with a mutex flag.

#### Scenario: Session list displays running sessions

- GIVEN the user is authenticated and has selected a workspace
- WHEN the side panel is open
- THEN the extension displays all sessions for the workspace
- AND each session shows: name, phase badge, model, creation time, prompt preview

#### Scenario: Phase change triggers fast polling

- GIVEN a session transitions from Stopped to Creating
- WHEN the next poll detects the transition
- THEN the polling interval switches to 3 seconds for 30 seconds
- AND reverts to 15 seconds afterward

### Requirement: Session Lifecycle Controls

The extension SHALL provide action buttons based on session phase:

| Phase | Available Actions |
|-------|------------------|
| Running | Chat, Stop |
| Creating, Pending | (no actions — transitional) |
| Stopped, Completed, Failed | Start, Delete |
| Stopping | (no actions — transitional) |

#### Scenario: Stop session with inline confirmation

- GIVEN a running session
- WHEN the user clicks Stop
- THEN the Stop button is replaced with "Stop?" (danger) and "No" (cancel) buttons
- AND clicking "Stop?" calls `POST /sessions/{id}/stop`
- AND clicking "No" restores the original Stop button

#### Scenario: Delete session with inline confirmation

- GIVEN a stopped session
- WHEN the user clicks Delete
- THEN the Delete and Start buttons are replaced with "Delete?" and "No"
- AND clicking "Delete?" calls `DELETE /sessions/{id}`
- AND the session is removed from the list

### Requirement: Create Session

The extension SHALL provide a form to create new sessions with fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Session Name | text | Yes | |
| Initial Prompt | textarea | No | |
| Repository URL | text + datalist | No | Autocomplete from history (max 20 entries) |
| Model | select dropdown | No | Options: Claude Sonnet 4.6, Claude Opus 4.6, Claude Haiku 4.5 |

#### Scenario: Create session with repository history

- GIVEN the user has previously created sessions with repository URLs
- WHEN the user opens the Create Session form
- THEN the Repository URL field offers autocomplete suggestions from stored history

---

## Chat

### Requirement: Message History

The extension SHALL load message history via `GET /api/ambient/v1/sessions/{id}/messages?after_seq=0`.

Message types and their rendering:

| event_type | Rendering |
|------------|-----------|
| user | Right-aligned blue bubble |
| assistant | Left-aligned gray bubble |
| tool_use | Bordered block with tool name and arguments |
| tool_result | Bordered block with "Result" label |
| error | Error-styled bubble |
| system | Muted-styled bubble |

#### Scenario: Load chat history for a running session

- GIVEN a running session with existing messages
- WHEN the user opens the chat view
- THEN the extension loads messages via REST API
- AND renders them in chronological order
- AND connects an SSE stream for new messages
- AND the chat input is active

### Requirement: Live Message Streaming

After loading history, the extension SHALL connect to `GET /api/ambient/v1/sessions/{id}/messages?after_seq=N` with `Accept: text/event-stream` for real-time message delivery.

#### Scenario: Send message and receive streamed response

- GIVEN the user is in the chat view of a running session
- WHEN the user sends a message
- THEN the user message appears immediately (optimistic rendering)
- AND the extension calls `POST /api/ambient/v1/sessions/{id}/messages`
- AND the assistant response streams in via SSE
- AND new messages render incrementally as SSE events arrive

### Requirement: Chat Input Behavior

- Enter key sends the message (Shift+Enter does not)
- Chat input SHALL remain fixed at the bottom of the panel
- Auto-scroll SHALL only trigger when the user is within 100px of the bottom

---

## Workspace Management

### Requirement: Workspace Switching

The extension SHALL provide a project dropdown in the toolbar for quick workspace switching.

#### Scenario: Switch workspace from toolbar

- GIVEN the user has multiple workspaces
- WHEN the user selects a different workspace from the toolbar dropdown
- THEN the extension updates the stored project name
- AND refreshes the session list for the new workspace
- AND shows a success toast

### Requirement: Workspace CRUD

- `GET /api/ambient/v1/projects` — list workspaces
- `POST /api/ambient/v1/projects` — create workspace
- `DELETE /api/ambient/v1/projects/{id}` — delete workspace (with inline confirmation)

#### Scenario: Delete last workspace

- GIVEN only one workspace exists
- WHEN the user deletes it
- THEN the extension clears the stored project name
- AND returns to the setup wizard

---

## Notifications

### Requirement: Event-Driven Notifications

The background service worker SHALL monitor SSE event streams from running sessions and create notifications for:

| Event | Notification Kind | Trigger Pattern |
|-------|------------------|-----------------|
| AskUserQuestion tool call | `input_needed` | `TOOL_CALL_START` with tool name matching `/ask.*user|user.*question|askuserquestion/i` |
| Run completed | `run_finished` | `RUN_FINISHED` event |
| Run error | `error` | `RUN_ERROR` event |

Notifications SHALL be stored in chrome.storage.local, capped at 50 entries (oldest evicted first).

Unread notification count SHALL display on the extension badge (red background).

---

## UI Structure

### Requirement: Title Bar

A persistent bar at the top of the side panel showing connection state:

| Element | Behavior |
|---------|----------|
| Status dot | Green (connected), yellow (connecting), red (error), gray (disconnected) |
| Cluster name | Extracted from server URL. Click → copy full URL to clipboard |
| Server version | Shows `server:unknown` until API version endpoint exists. Click → copy URL |
| Extension version | Shows `extension:v{version}`. Click → open GitHub repository |

Cluster name extraction: For ROSA URLs (`apps.rosa.{cluster}.xxx`), extract the cluster segment. For other URLs, use the first hostname segment.

### Requirement: Setup Wizard

Two-step wizard with navigation controls on both steps:

| Step | Content | Navigation |
|------|---------|------------|
| Step 1: Connect | Server URL input (with history autocomplete), SSO login button, OR manual token paste | Reset button (✕) clears all credentials |
| Step 2: Workspace | Workspace dropdown, Go button, create new workspace form | Back button (←) returns to step 1 and clears auth |

#### Scenario: Return to login from workspace step

- GIVEN the user is on the workspace selection step
- WHEN the user clicks the back button
- THEN stored tokens are cleared
- AND the wizard returns to step 1

### Requirement: Theme Support

The extension SHALL support dark and light themes via CSS custom properties. Light theme SHALL be the default. Theme selection SHALL persist in chrome.storage.local.

---

## Help Chatbot

### Requirement: In-Extension Help

The extension SHALL provide a help panel (accessible via "?" button) with:
- A chat interface connected to a help agent session
- Static resource links (documentation, issues, community)
- Optimistic UI: the panel opens immediately with buffered input while the help session starts

#### Scenario: First help question triggers session creation

- GIVEN no help session exists for the current workspace
- WHEN the user types a question and sends it
- THEN the user message appears immediately
- AND the extension creates a help session with a comprehensive ACP knowledge prompt
- AND buffers the message until the session is ready
- AND sends the message when the session starts
- AND connects SSE for streaming the response

---

## Background Service Worker Contract

### Requirement: Service Worker Lifecycle

The service worker SHALL:
- Import `utils.js`, `oauth.js`, `api-client.js` via `importScripts`
- On activation, check authentication and project, start polling if both present
- Register `chrome.action.onClicked` to toggle the side panel

### Requirement: Message Protocol

The service worker SHALL handle these message types from extension pages:

| Message Type | Action | Response |
|-------------|--------|----------|
| `OAUTH_LOGIN` | Run OAuth flow | `{ ok, result? , error? }` |
| `OAUTH_LOGOUT` | Clear tokens, stop polling | `{ ok }` |
| `GET_NOTIFICATIONS` | Read from storage | `{ notifications }` |
| `MARK_ALL_READ` | Set all read, clear badge | `{ ok }` |
| `REFRESH_SESSIONS` | Trigger immediate poll | `{ ok }` |
| `SESSION_TRANSITIONING` | Switch to fast polling for 30s | `{ ok }` |

The service worker SHALL broadcast these messages to extension pages:

| Message Type | When |
|-------------|------|
| `SESSIONS_UPDATED` | Session data changed after poll |
| `SSE_EVENT` | SSE event received from a running session |
| `AUTH_EXPIRED` | Authentication failed and cannot be recovered |
| `NOTIFICATION_ADDED` | New notification created |

---

## Chrome Extension Manifest

### Requirement: Permissions

| Permission | Purpose |
|-----------|---------|
| `sidePanel` | Side panel UI |
| `storage` | Persistent local storage for tokens, config, cache |
| `identity` | OAuth `launchWebAuthFlow` |
| `activeTab` | Side panel open from action click |

### Requirement: Content Security Policy

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src https: http://localhost:*
```

### Requirement: Host Permissions

`https://*/*` and `http://localhost/*` — required to connect to any ACP server instance.

---

## Testing

### Requirement: End-to-End Test Coverage

The extension SHALL be testable via Cypress or Playwright against a running ACP instance.

#### Scenario: Login and session list

- GIVEN a running ACP server and valid credentials
- WHEN the user completes the login wizard
- THEN the session list loads and displays sessions for the selected workspace

#### Scenario: Create and interact with a session

- GIVEN the user is authenticated and has selected a workspace
- WHEN the user creates a session with a name and prompt
- THEN the session appears in the list
- AND the user can open the chat view
- AND send a message and receive a response

#### Scenario: Session lifecycle

- GIVEN a running session
- WHEN the user stops it
- THEN the phase changes to Stopped
- AND the Start and Delete buttons appear
- AND the user can restart or delete the session

#### Scenario: Workspace switching

- GIVEN the user has access to multiple workspaces
- WHEN the user selects a different workspace from the toolbar dropdown
- THEN the session list updates to show sessions from the new workspace

#### Scenario: Auth expiry recovery

- GIVEN a stored token that has expired
- WHEN the extension attempts an API call
- THEN the wizard login screen is shown
- AND the user can re-authenticate and resume

### Requirement: Unit Testability

Core modules SHALL be testable in isolation without Chrome APIs:

| Module | Testable Without Chrome | Test Strategy |
|--------|------------------------|---------------|
| `api-client.js` (apiRequest, parseSSEStream) | Yes (mock fetch) | Verify URL construction, header injection, error handling, SSE parsing |
| `oauth.js` (base64urlEncode, PKCE generation) | Partially (crypto.subtle available in Node) | Verify PKCE challenge derivation, state generation |
| `utils.js` (escHtml, timeAgo) | Yes | Verify escaping, time formatting edge cases |
| `help-prompt.js` | Yes (static string) | Verify prompt contains key sections |

---

## Metrics and Observability

### Requirement: Connection Health Indicator

The extension SHALL provide visible connection health via the title bar status dot:

| State | Color | Meaning |
|-------|-------|---------|
| Connected | Green | Last poll succeeded |
| Connecting | Yellow | Poll in progress or initial load |
| Error | Red | Auth expired or API unreachable |
| Disconnected | Gray | No credentials or not configured |

### Requirement: Error Surfacing

All API errors SHALL surface to the user via toast notifications with the error reason from the API response. The extension SHALL NOT silently swallow errors that affect user-visible state.

#### Scenario: API error shown to user

- GIVEN the user performs an action (create session, start, stop, delete)
- WHEN the API returns a non-2xx response
- THEN the extension shows an error toast with the `reason` field from the API error body
- AND the UI remains in a consistent state (no half-applied changes)

### Requirement: Badge Notification Count

The extension badge SHALL display the count of unread notifications. The badge SHALL clear when all notifications are marked as read.

---

## Logging and Debugging

### Requirement: Console Logging

The extension SHALL log to the browser console (visible via DevTools) at these levels:

| Level | What |
|-------|------|
| `console.warn` | Poll failures, SSE connection errors, SSE reconnection attempts |
| `console.error` | Should not be used for expected errors (auth expiry, network issues) |
| Silent (no log) | Successful operations, normal polling, broadcast failures when no listener exists |

The extension SHALL NOT flood the console — failed SSE reconnections on auth errors SHALL stop reconnecting rather than logging repeatedly.

### Requirement: DevTools Inspectability

- The side panel SHALL be inspectable via right-click → Inspect
- The service worker SHALL be inspectable via `chrome://extensions` → "service worker" link
- API requests SHALL be visible in the Network tab of the appropriate DevTools window
- SSE streams SHALL be visible as long-lived requests in the Network tab

#### Scenario: Debug a failing API call

- GIVEN the user opens the side panel DevTools Network tab
- WHEN an API call fails
- THEN the request URL, headers, response status, and error body are visible in the Network tab
- AND a `console.warn` entry appears in the Console tab

---

## Specification Quality Checklist

- [x] All requirements are testable (Given/When/Then scenarios)
- [x] No implementation details in requirements (tech-agnostic where possible)
- [x] User scenarios cover primary workflows
- [x] Success criteria are measurable
- [x] Data model captures all entities
- [x] External interfaces are documented
- [x] Known gaps from previous implementation are addressed
- [x] Testing strategy defined (E2E + unit)
- [x] Observability requirements specified (connection health, error surfacing, badge)
- [x] Logging and debugging requirements specified
