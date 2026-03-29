# Tasks: Workspace Management & Guided Setup

**Input**: Design documents from `/specs/001-workspace-management/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: No test framework exists for this project. Manual testing via Chrome extension reload.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

All files are at repository root — this is a no-build-step Chrome extension.

---

## Phase 1: Setup

**Purpose**: Foundation changes that all user stories depend on

- [x] T001 Change `getConfig()` default for `projectName` from `'default'` to `''` (empty string) in `utils.js`
- [x] T002 Add `!projectName` guard to `pollSessions()` in `background.js` — return early if `apiKey` or `projectName` is falsy, preventing 404s when no workspace is selected
- [x] T003 Add `projectName` check to `connectSSE()` in `background.js` — return early if config has no `projectName` set

**Checkpoint**: Extension no longer crashes or fires bad requests when no workspace is configured.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Workspace API functions used by both wizard and settings

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Add `fetchWorkspaces()` function in `sidepanel.js` — calls `GET {baseUrl}/api/projects` with Bearer token, returns array of AmbientProject objects. Handle pagination if response is paginated. Use `escHtml()` for any display rendering.
- [x] T005 [P] Add `createWorkspace(name, displayName, description)` function in `sidepanel.js` — calls `POST {baseUrl}/api/projects` with JSON body `{ name, displayName, description }`, returns created AmbientProject. Validate required fields (name, displayName) before sending.
- [x] T006 [P] Add `deleteWorkspace(name)` function in `sidepanel.js` — calls `DELETE {baseUrl}/api/projects/{name}`, returns boolean success. Handle 204 response.
- [x] T007 [P] Add `switchWorkspace(projectName)` function in `sidepanel.js` — saves `projectName` to `chrome.storage.local`, sends `REFRESH_SESSIONS` message to background, and calls `loadSessions()` to refresh the UI.

**Checkpoint**: Foundation ready — workspace CRUD functions available for wizard and settings.

---

## Phase 3: User Story 1 - First-Time Setup Wizard (Priority: P1) MVP

**Goal**: New users can connect to ACP and select/create their first workspace without leaving the extension.

**Independent Test**: Clear extension storage, reopen side panel, walk through wizard steps. Verify sessions load after completing the wizard.

### Implementation for User Story 1

- [x] T008 [US1] Add wizard overlay HTML to `sidepanel.html` — create a `<div id="wizard-panel" class="overlay-panel">` with two steps: Step 1 (Connect) has URL input, API Key input, Connect button, and inline error/status area. Step 2 (Select/Create Workspace) has workspace list container, "Create Your First Workspace" button, and inline create workspace form (name, displayName, description fields, Create button). Include step indicator (1/2 dots/numbers). Place it inside `.panel-body` alongside existing overlay panels.
- [x] T009 [US1] Add wizard styles to `styles.css` — style the wizard overlay panel, step indicator, workspace list items (selectable cards showing displayName, name, status badge), create workspace inline form, and loading/error states. Match existing dark-first theme using CSS custom properties. Style the step indicator as dots or numbered steps.
- [x] T010 [US1] Add `showWizard()` and `hideWizard()` functions in `sidepanel.js` — `showWizard()` activates the wizard overlay and hides the sessions panel. `hideWizard()` deactivates the wizard and shows the sessions panel. Integrate with the existing `showPanel()` function pattern.
- [x] T011 [US1] Implement wizard Step 1 (Connect) logic in `sidepanel.js` — wire the Connect button: read URL and API key from wizard inputs, call `fetchWorkspaces()` (which validates credentials and returns workspace list). On success: save `baseUrl` and `apiKey` to `chrome.storage.local`, advance to Step 2 with the fetched workspace list. On failure: show inline error, preserve entered data.
- [x] T012 [US1] Implement wizard Step 2 (Select/Create Workspace) logic in `sidepanel.js` — render the workspace list from Step 1 results. Each workspace is a clickable card showing `displayName`, `name`, and status badge. If no workspaces exist, show "No workspaces found" with a "Create Your First Workspace" button. Clicking a workspace calls `switchWorkspace(name)` and then `hideWizard()`. The inline create form calls `createWorkspace()`, then auto-selects the new workspace and closes the wizard.
- [x] T013 [US1] Update initialization logic in `sidepanel.js` — modify the init section (currently `loadSettings(); loadSessions();`) to check config state first. If `!apiKey` or `!projectName`, call `showWizard()` instead of `loadSessions()`. If both are set, proceed normally with `loadSessions()`.
- [x] T014 [US1] Update `showPanel()` in `sidepanel.js` to handle the wizard panel — add `wizard` as a panel option so that `showPanel('wizard')` shows the wizard and hides other panels. Ensure the wizard overlay follows the same show/hide pattern as settings and create panels.

**Checkpoint**: First-time setup wizard works end-to-end. New users can connect and select/create a workspace.

---

## Phase 4: User Story 2 - Create Workspace (Priority: P1)

**Goal**: Users can create workspaces from both the wizard (Phase 3) and the settings panel.

**Independent Test**: Open settings, click Create Workspace, fill in form, verify workspace appears in the selector.

### Implementation for User Story 2

- [x] T015 [US2] Add create workspace UI elements to settings panel in `sidepanel.html` — add a "Create Workspace" button and an inline collapsible form below the workspace selector (name input, displayName input, description textarea, Create button, status area). This is separate from the wizard's create form.
- [x] T016 [US2] Add create workspace styles to `styles.css` — style the settings create workspace form section (collapsible, inline, consistent with existing settings form styling).
- [x] T017 [US2] Wire settings create workspace form in `sidepanel.js` — click handler on "Create Workspace" button toggles the inline form visibility. Click handler on Create button: validate inputs, call `createWorkspace()`, on success refresh workspace selector (call `loadWorkspaceSelector()`), auto-select the new workspace, show success message, collapse the form.

**Checkpoint**: Workspace creation works from settings panel. Combined with Phase 3, creation works from both wizard and settings.

---

## Phase 5: User Story 3 - Switch Workspace (Priority: P2)

**Goal**: Users can switch between workspaces via a dropdown in settings instead of manually typing.

**Independent Test**: Open settings with 2+ workspaces, select a different one from the dropdown, verify session list refreshes with new workspace's sessions.

### Implementation for User Story 3

- [x] T018 [US3] Replace "Project / Namespace" text input with workspace selector dropdown in `sidepanel.html` — replace the `<input type="text" id="settings-project">` with a `<select id="settings-project">` dropdown. Add a refresh button next to it to reload the workspace list. Keep the form-group label as "Workspace".
- [x] T019 [US3] Add `loadWorkspaceSelector()` function in `sidepanel.js` — calls `fetchWorkspaces()`, populates the `settings-project` dropdown with `<option>` elements showing `displayName (name)` for each workspace, pre-selects the current `projectName`. Show a loading state while fetching. Handle empty list (show "No workspaces" option).
- [x] T020 [US3] Wire workspace selector change handler in `sidepanel.js` — add `change` event listener on `settings-project` dropdown. On change: call `switchWorkspace(selectedValue)` to save the new project name and refresh sessions immediately.
- [x] T021 [US3] Update `loadSettings()` in `sidepanel.js` — call `loadWorkspaceSelector()` when loading settings to populate the dropdown. Remove the old logic that sets the text input value for projectName.
- [x] T022 [US3] Update `save-settings-btn` handler in `sidepanel.js` — read `projectName` from the `<select>` dropdown value instead of a text input. Keep the rest of the save logic (saving baseUrl, apiKey, triggering REFRESH_SESSIONS).

**Checkpoint**: Users can switch workspaces via dropdown. Session list updates immediately on switch.

---

## Phase 6: User Story 4 - Delete Workspace (Priority: P3)

**Goal**: Users can delete workspaces from settings with a type-to-confirm safety mechanism.

**Independent Test**: Create a test workspace, delete it from settings, verify it disappears from the dropdown and server.

### Implementation for User Story 4

- [x] T023 [US4] Add delete workspace UI to `sidepanel.html` — add a "Delete Workspace" button (destructive red styling) in the settings workspace section. Add a confirmation overlay/dialog: text warning about permanent deletion, text input to type workspace name, Cancel and Delete buttons, status area.
- [x] T024 [US4] Add delete confirmation dialog styles to `styles.css` — style the confirmation dialog (modal overlay or inline section), destructive red button styling, warning text, confirmation input field.
- [x] T025 [US4] Wire delete workspace logic in `sidepanel.js` — click handler on "Delete Workspace" shows the confirmation dialog with the current workspace name. Confirm button: check typed name matches, call `deleteWorkspace(name)`. On success: if deleted workspace was the active one, clear `projectName` from storage and show wizard or prompt for new selection. Refresh the workspace selector. On failure: show error. Cancel button: close dialog.

**Checkpoint**: Delete workspace works with type-to-confirm safety. Active workspace deletion triggers re-selection.

---

## Phase 7: User Story 5 - Connection Validation Without Workspace (Priority: P2)

**Goal**: "Test Connection" validates credentials without requiring a workspace.

**Independent Test**: Enter valid URL + API key with no workspace selected, click Test Connection, verify success message.

### Implementation for User Story 5

- [x] T026 [US5] Update `test-connection-btn` click handler in `sidepanel.js` — change the test endpoint from `GET {baseUrl}/api/projects/{projectName}/agentic-sessions?limit=1` to `GET {baseUrl}/api/projects`. Remove the projectName requirement from validation. Save only baseUrl and apiKey before testing (not projectName). On success, show "Connected successfully!" and optionally display workspace count.

**Checkpoint**: Test Connection works without a workspace configured.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases and improvements that affect multiple user stories

- [x] T027 [P] Handle workspace status badges in `sidepanel.js` and `styles.css` — show status indicator (active/pending/archived) next to each workspace in selector and wizard list. Warn when selecting a non-active workspace.
- [x] T028 [P] Handle externally deleted workspace in `background.js` — detect 404 responses from session polling (workspace no longer exists). Send a message to sidepanel to prompt workspace re-selection.
- [x] T029 [P] Handle network errors in wizard in `sidepanel.js` — show retry button on connection failures during wizard steps. Preserve all entered data across retries.
- [x] T030 Add workspace name to session list header in `sidepanel.html` and `sidepanel.js` — show the active workspace name in the header bar so users always know which workspace they're viewing.
- [x] T031 Run quickstart.md validation — manually test all flows described in `specs/001-workspace-management/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1 Wizard)**: Depends on Phase 2
- **Phase 4 (US2 Create)**: Depends on Phase 2. Can run in parallel with Phase 3 but shares create form pattern.
- **Phase 5 (US3 Switch)**: Depends on Phase 2. Can run in parallel with Phase 3/4.
- **Phase 6 (US4 Delete)**: Depends on Phase 2. Can run in parallel with Phase 3/4/5.
- **Phase 7 (US5 Connection)**: Depends on Phase 1 only. Can run in parallel with Phase 2+.
- **Phase 8 (Polish)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (Wizard)**: Independent after Phase 2
- **US2 (Create)**: Independent after Phase 2 (shares `createWorkspace()` from Phase 2 with US1)
- **US3 (Switch)**: Independent after Phase 2
- **US4 (Delete)**: Independent after Phase 2
- **US5 (Connection)**: Independent after Phase 1

### Parallel Opportunities

- T004, T005, T006, T007 (Phase 2 functions) can all run in parallel — different functions, no dependencies
- T027, T028, T029 (Phase 8 polish) can all run in parallel — different concerns
- US3, US4, US5 can run in parallel after Phase 2 — different UI areas

---

## Parallel Example: Phase 2 (Foundational)

```bash
# All four workspace functions can be implemented simultaneously:
Task: "Add fetchWorkspaces() in sidepanel.js"
Task: "Add createWorkspace() in sidepanel.js"
Task: "Add deleteWorkspace() in sidepanel.js"
Task: "Add switchWorkspace() in sidepanel.js"
```

## Parallel Example: User Stories 3-5

```bash
# After Phase 2, these stories can be worked on simultaneously:
Task: "US3 - Replace text input with dropdown in sidepanel.html"
Task: "US4 - Add delete workspace UI in sidepanel.html"
Task: "US5 - Update test connection handler in sidepanel.js"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T007)
3. Complete Phase 3: US1 Wizard (T008-T014)
4. Complete Phase 4: US2 Create (T015-T017)
5. **STOP and VALIDATE**: New user can install extension, connect, create workspace, see sessions

### Incremental Delivery

1. Setup + Foundational → Extension handles missing workspace gracefully
2. Add US1 Wizard → New users can onboard (MVP!)
3. Add US2 Create → Workspace creation from settings too
4. Add US3 Switch → Dropdown replaces text input
5. Add US4 Delete → Full CRUD complete
6. Add US5 Connection → Test Connection decoupled from workspace
7. Polish → Edge cases, status badges, error recovery

---

## Notes

- [P] tasks = different files or non-overlapping sections, no dependencies
- [Story] label maps task to specific user story for traceability
- All DOM text insertion MUST use `escHtml()` from utils.js to prevent XSS
- All API calls use `Authorization: Bearer {apiKey}` header
- Workspace names are slug format — the server validates on creation
- The design reference document is preserved at `snazzy-bouncing-valley.md` in the repo root
