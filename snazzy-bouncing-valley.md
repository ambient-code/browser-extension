# Design Spec: Workspace Management & Guided Setup

## Problem

The ACP Browser Extension requires a pre-configured workspace (projectName) before it can do anything. Every API call embeds `projectName` in the URL path. New users must already know their workspace name—there's no way to discover, create, or manage workspaces from the extension. This blocks onboarding.

## Goal

Allow users to connect to ACP with just a URL and API key, then discover, create, select, switch, and delete workspaces entirely from within the extension. A guided first-run experience walks new users through setup.

---

## Architecture Context

- **Stack:** Vanilla JS, Chrome Extension Manifest V3, no build step, no ES modules
- **Config storage:** `chrome.storage.local` holds `baseUrl`, `apiKey`, `projectName`
- **Config reader:** `getConfig()` in `utils.js` returns all three (projectName defaults to `'default'`)
- **Service worker:** `background.js` uses `importScripts('utils.js')`, polls sessions, manages SSE
- **UI:** `sidepanel.js` / `sidepanel.html` — single-page with overlay panels for settings, chat, create session
- **Theming:** Dark-first, CSS custom properties in `styles.css`
- **XSS prevention:** All DOM text insertion uses `escHtml()` from `utils.js`

### Current Settings UI (sidepanel.html)

Three text inputs: Base URL, API Key, Project/Namespace. Two buttons: Save Settings, Test Connection. Test Connection validates by calling `GET {baseUrl}/api/projects/{projectName}/agentic-sessions?limit=1`.

### Current Config Flow

1. `getConfig()` returns `{ baseUrl, apiKey, projectName }` — projectName defaults to `'default'`
2. `background.js:pollSessions()` skips if `!apiKey`
3. All API URLs use `${baseUrl}/api/projects/${projectName}/...`

---

## Backend API (confirmed available)

All endpoints use `Authorization: Bearer {apiKey}`.

### Project/Workspace Endpoints (no projectName required)

| Method | Endpoint | Body | Response |
|--------|----------|------|----------|
| `GET` | `/api/projects` | — | Paginated array of `AmbientProject` |
| `POST` | `/api/projects` | `{ name, displayName, description?, labels? }` | Created `AmbientProject` |
| `DELETE` | `/api/projects/:projectName` | — | 204 No Content |

### AmbientProject Shape

```json
{
  "name": "string",
  "displayName": "string",
  "description": "string",
  "labels": { "key": "value" },
  "annotations": { "key": "value" },
  "creationTimestamp": "RFC3339 string",
  "status": "active | archived | pending",
  "isOpenShift": false
}
```

### Session Endpoints (require projectName — unchanged)

| Method | Endpoint |
|--------|----------|
| `GET` | `/api/projects/{projectName}/agentic-sessions?limit=100` |
| `POST` | `/api/projects/{projectName}/agentic-sessions` |
| `POST` | `/api/projects/{projectName}/agentic-sessions/{name}/start` |
| `POST` | `/api/projects/{projectName}/agentic-sessions/{name}/stop` |
| `POST` | `/api/projects/{projectName}/agentic-sessions/{name}/agui/run` |
| `GET` | `/api/projects/{projectName}/agentic-sessions/{name}/agui/events` |
| `GET` | `/api/projects/{projectName}/runner-types` |
| `GET` | `/api/projects/{projectName}/models` |
| `GET` | `/api/workflows/ootb?project={projectName}` |

---

## Design

### 1. Decouple Connection from Workspace

**Current:** The extension treats URL + API key + projectName as one unit. You can't validate credentials without a valid projectName.

**New:** Connection (URL + API key) is independent of workspace selection. `GET /api/projects` validates credentials without needing a projectName.

#### Changes to `utils.js`

- `getConfig()` should return `projectName` as `''` (empty string) instead of defaulting to `'default'` when not set. This makes the "no workspace selected" state explicit.

#### Changes to `background.js`

- `pollSessions()` should check `if (!apiKey || !projectName) return;` — connected but no workspace means don't poll sessions
- SSE subscriptions should similarly guard on projectName being set

### 2. Guided Setup Wizard (First-Run Experience)

Show a multi-step wizard overlay when the extension detects no valid configuration (no apiKey set). The wizard replaces the current "No sessions" empty state.

#### Step 1: Connect to ACP

- **Inputs:** Base URL (text, placeholder "https://acp.example.com"), API Key (password)
- **Action:** "Connect" button validates by calling `GET {baseUrl}/api/projects` with Bearer token
- **Success:** Stores baseUrl and apiKey, advances to Step 2
- **Failure:** Shows inline error ("Connection failed — check your URL and API key")

#### Step 2: Select or Create Workspace

- **If workspaces exist:** Show a list of available workspaces (name + displayName + status). Each is selectable. Include a "Create New Workspace" button.
- **If no workspaces exist:** Show a message "No workspaces found" with a prominent "Create Your First Workspace" button.
- **Create workspace inline form:** name (required, slug-style), display name (required, freeform), description (optional). "Create" button calls `POST /api/projects`. On success, auto-selects the new workspace.
- **Selection:** Clicking a workspace selects it and advances to Step 3.

#### Step 3: Done

- Saves projectName to storage
- Sends `REFRESH_SESSIONS` to background
- Dismisses the wizard, shows the normal session list
- Brief success message: "Connected to {displayName}"

#### Wizard State Management

- Wizard visibility is determined by config state: show wizard if `!apiKey` (never connected) or if `apiKey` is set but `!projectName` (connected but no workspace)
- After wizard completes, it doesn't show again unless user clears settings
- Wizard should be a full-overlay panel similar to the existing settings/chat overlays

### 3. Workspace Management in Settings

Replace the current "Project / Namespace" text input with workspace management controls.

#### Workspace Selector

- **Dropdown/select** populated from `GET /api/projects` when settings panel opens
- Shows `displayName (name)` for each option
- Current workspace is pre-selected
- Changing selection immediately updates `projectName` in storage and triggers `REFRESH_SESSIONS`

#### Create Workspace

- "Create Workspace" button below the selector
- Opens an inline form or small dialog: name, displayName, description
- Calls `POST /api/projects`
- On success: refreshes the workspace list, auto-selects the new workspace

#### Delete Workspace

- "Delete" button (destructive styling — red) next to the selector or as a separate action
- Shows a confirmation: "Delete workspace '{name}'? This cannot be undone. All sessions in this workspace will be lost."
- Requires typing the workspace name to confirm (standard destructive confirmation pattern)
- Calls `DELETE /api/projects/{projectName}`
- On success: removes from list, clears projectName if it was the active one, user must select another workspace

#### Test Connection

- Change "Test Connection" to use `GET /api/projects` instead of the project-scoped sessions endpoint
- This validates URL + API key independent of workspace selection

### 4. UI Layout

The wizard and workspace management should follow the existing extension UI patterns:

- **Overlay panels** that slide in (like existing settings, chat, create-session panels)
- **Dark-first theme** using existing CSS custom properties
- **Form styling** matching existing inputs/buttons
- **Loading states** using existing `loadingDotsSVG()` helper
- **Error display** as inline messages (matching existing pattern in settings)

### 5. State Transitions

```
┌─────────────┐
│  No Config  │──── Open Extension ────► Wizard Step 1 (Connect)
└─────────────┘
                                              │
                                         Valid credentials
                                              │
                                              ▼
                                        Wizard Step 2 (Select/Create Workspace)
                                              │
                                        Workspace selected
                                              │
                                              ▼
┌─────────────┐                         Normal Session List
│  Has Config │──── Open Extension ────► Normal Session List
└─────────────┘
       │
       │── Settings → Workspace Selector (switch/create/delete)
       │── Settings → Clear credentials → Back to Wizard
```

### 6. Edge Cases

- **API key valid but no permission to list projects:** Show error, suggest checking permissions
- **Workspace deleted externally:** Session polling will start failing with 404. Detect this and prompt user to select a different workspace.
- **Workspace in "pending" or "archived" status:** Show status badge, allow selection but warn if not "active"
- **Network errors during wizard:** Show retry button, don't lose entered data
- **Multiple tabs/windows:** `chrome.storage.local` changes propagate via `chrome.storage.onChanged` listener (already used in background.js for theme changes — extend for config changes)

---

## Files to Modify

| File | Changes |
|------|---------|
| `utils.js` | `getConfig()`: default projectName to `''` instead of `'default'` |
| `sidepanel.html` | Add wizard overlay HTML, restructure settings panel workspace section |
| `sidepanel.js` | Add wizard flow logic, workspace CRUD functions, modified settings panel, workspace selector |
| `background.js` | Guard polling/SSE on `projectName` being non-empty |
| `styles.css` | Wizard overlay styles, workspace selector styles, step indicator styles |

## New Functions (sidepanel.js)

- `fetchWorkspaces()` — `GET /api/projects`, returns array of AmbientProject
- `createWorkspace(name, displayName, description)` — `POST /api/projects`
- `deleteWorkspace(name)` — `DELETE /api/projects/{name}`
- `showWizard()` / `hideWizard()` — wizard overlay visibility
- `wizardStep1()` / `wizardStep2()` — wizard step rendering
- `loadWorkspaceSelector()` — populate dropdown in settings
- `switchWorkspace(projectName)` — update config + trigger refresh

## No New Files

All changes fit within existing files. No new HTML pages, JS files, or assets needed.
