# Research: Workspace Management & Guided Setup

## R-001: ACP Project/Workspace API

**Decision**: Use the confirmed ACP backend endpoints for workspace CRUD.

**Rationale**: The ACP platform (ambient-code/platform) already exposes project management endpoints that the browser extension has never used. These are production-ready and match our requirements exactly.

**Endpoints confirmed**:
- `GET /api/projects` — List all accessible projects (paginated)
- `POST /api/projects` — Create project (body: `{ name, displayName, description?, labels? }`)
- `DELETE /api/projects/:projectName` — Delete project (returns 204)

**Response shape** (`AmbientProject`):
```json
{
  "name": "string",
  "displayName": "string",
  "description": "string",
  "labels": {},
  "annotations": {},
  "creationTimestamp": "RFC3339",
  "status": "active | archived | pending",
  "isOpenShift": false
}
```

**Alternatives considered**: None — these are the canonical ACP APIs.

## R-002: Connection Validation Without Workspace

**Decision**: Use `GET /api/projects` as the connection validation endpoint, replacing the current `GET /api/projects/{projectName}/agentic-sessions?limit=1`.

**Rationale**: The projects listing endpoint requires only valid credentials (URL + Bearer token), not a workspace name. This decouples connection testing from workspace selection, which is essential for the wizard flow where users connect before selecting a workspace.

**Alternatives considered**: A dedicated health/ping endpoint — but `GET /api/projects` serves double duty: validates credentials AND returns the workspace list for the next wizard step.

## R-003: Wizard State Detection

**Decision**: Determine wizard visibility from config state in `chrome.storage.local`:
- Show wizard Step 1 (Connect) if `!apiKey`
- Show wizard Step 2 (Select Workspace) if `apiKey` is set but `!projectName`
- Show normal session list if both are set

**Rationale**: This is the simplest approach — no additional state flags needed. The config values themselves encode the user's progress through setup.

**Alternatives considered**: A separate `setupComplete` flag in storage — rejected because it duplicates information already encoded in the config state and creates sync issues.

## R-004: Workspace Selector Pattern

**Decision**: Replace the `<input type="text">` for "Project / Namespace" with a `<select>` dropdown populated dynamically from `GET /api/projects` when the settings panel opens. Include "Create Workspace" and "Delete Workspace" action buttons below the dropdown.

**Rationale**: A dropdown prevents typos and shows users what's available. The dynamic population ensures the list is always fresh. Action buttons below the dropdown keep the UI clean without introducing modal dialogs for simple actions.

**Alternatives considered**: A searchable combobox — rejected as over-engineering for the expected scale (~10-50 workspaces per user). A standard `<select>` is sufficient and matches the existing extension UI patterns (runner type, model, and workflow selectors in the create session panel).

## R-005: Destructive Deletion Confirmation

**Decision**: Require users to type the workspace name to confirm deletion, matching the standard destructive confirmation pattern used by GitHub, AWS, etc.

**Rationale**: Workspace deletion is permanent and irreversible. It destroys all sessions within the workspace. A simple "Are you sure?" button click is insufficient for this level of destruction.

**Alternatives considered**: Simple confirm/cancel dialog — rejected because accidental deletion could be catastrophic.

## R-006: Background Polling Guard

**Decision**: Add `!projectName` to the existing `!apiKey` guard in `pollSessions()` in background.js.

**Rationale**: When a user is connected but hasn't selected a workspace (e.g., during wizard Step 2), polling for sessions would fail with 404 because the session endpoint requires `projectName`. Guarding on both values prevents unnecessary failed requests.

**Alternatives considered**: Catching and silently ignoring 404s — rejected because it masks real errors and wastes network requests.
