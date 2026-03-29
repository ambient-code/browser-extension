# Feature Specification: Workspace Management & Guided Setup

**Feature Branch**: `001-workspace-management`
**Created**: 2026-03-28
**Status**: Draft
**Input**: User description: "Add workspace CRUD and guided setup wizard so users can connect without pre-existing workspace knowledge, create/select/switch/delete workspaces from the extension, and onboard new users seamlessly."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - First-Time Setup Wizard (Priority: P1)

A new user installs the extension for the first time. They have an ACP server URL and API key but no workspace yet. The extension detects no saved configuration and presents a guided setup wizard. The user enters their server URL and API key, the extension validates the connection, then shows available workspaces or prompts the user to create their first one. After selecting or creating a workspace, the extension shows the session list and is fully operational.

**Why this priority**: This is the core onboarding flow. Without it, new users are stuck — they must go to the web UI to create a workspace first, then manually type the workspace name into the extension settings. This is the primary blocker the feature addresses.

**Independent Test**: Can be fully tested by clearing extension storage, opening the side panel, and walking through the wizard. Delivers value by enabling zero-knowledge onboarding.

**Acceptance Scenarios**:

1. **Given** a fresh install with no saved configuration, **When** the user opens the extension side panel, **Then** a setup wizard is displayed instead of the empty session list.
2. **Given** the wizard is on the connection step, **When** the user enters a valid URL and API key and clicks Connect, **Then** the extension validates credentials by listing projects and advances to the workspace selection step.
3. **Given** the wizard is on the connection step, **When** the user enters invalid credentials and clicks Connect, **Then** an inline error message is displayed and the user remains on the connection step with their entered data preserved.
4. **Given** the wizard is on the workspace step and workspaces exist, **When** the workspace list loads, **Then** available workspaces are displayed with their display name, name, and status.
5. **Given** the wizard is on the workspace step and no workspaces exist, **When** the workspace list loads, **Then** a message "No workspaces found" is shown with a prominent "Create Your First Workspace" button.
6. **Given** the wizard is on the workspace step, **When** the user selects a workspace, **Then** the workspace is saved, the wizard closes, and the session list loads for the selected workspace.

---

### User Story 2 - Create Workspace (Priority: P1)

A user needs to create a new workspace — either during first-time setup (no workspaces exist) or later from the settings panel. They fill in a name, display name, and optional description. The workspace is created on the server, automatically selected as the active workspace, and the session list refreshes.

**Why this priority**: Equal to first-time setup because new users with no workspaces cannot proceed without creating one. This is the other half of the onboarding flow.

**Independent Test**: Can be tested by clicking "Create Workspace" (in wizard or settings), filling in the form, and verifying the workspace appears in the selector and on the server.

**Acceptance Scenarios**:

1. **Given** the create workspace form is visible, **When** the user enters a valid name and display name and clicks Create, **Then** the workspace is created on the server and automatically becomes the active workspace.
2. **Given** the create workspace form is visible, **When** the user submits without a required field, **Then** validation feedback is shown and no request is made.
3. **Given** the create workspace form is visible, **When** the server returns an error (e.g., name already taken), **Then** the error is displayed inline and the form remains open with entered data preserved.

---

### User Story 3 - Switch Workspace (Priority: P2)

A user with multiple workspaces wants to switch between them. In the settings panel, the workspace text input is replaced by a dropdown populated with available workspaces from the server. Selecting a different workspace immediately updates the active workspace and refreshes all session data.

**Why this priority**: Important for users managing multiple projects, but not a blocker for initial onboarding. Users can still manually edit the project name in settings today.

**Independent Test**: Can be tested by having two or more workspaces, opening settings, selecting a different workspace from the dropdown, and verifying the session list updates to show sessions from the newly selected workspace.

**Acceptance Scenarios**:

1. **Given** the settings panel is open and the user has multiple workspaces, **When** the workspace dropdown loads, **Then** all accessible workspaces are listed with the current one pre-selected.
2. **Given** the settings panel is open, **When** the user selects a different workspace from the dropdown, **Then** the active workspace updates immediately and sessions refresh for the new workspace.

---

### User Story 4 - Delete Workspace (Priority: P3)

A user wants to delete a workspace they no longer need. They click a delete button in the settings panel, confirm the destructive action by typing the workspace name, and the workspace is removed from the server. If it was the active workspace, they are prompted to select another.

**Why this priority**: Useful for cleanup but not critical for daily use. Deletion is a rare, high-consequence action.

**Independent Test**: Can be tested by creating a test workspace, then deleting it from settings and verifying it no longer appears in the workspace list.

**Acceptance Scenarios**:

1. **Given** the settings panel is open, **When** the user clicks Delete on a workspace, **Then** a confirmation dialog appears requiring the user to type the workspace name.
2. **Given** the confirmation dialog is open, **When** the user types the correct workspace name and confirms, **Then** the workspace is deleted from the server and removed from the dropdown.
3. **Given** the deleted workspace was the active workspace, **When** deletion succeeds, **Then** the active workspace is cleared and the user is prompted to select another workspace.
4. **Given** the confirmation dialog is open, **When** the user types an incorrect name or cancels, **Then** no deletion occurs and the dialog closes.

---

### User Story 5 - Connection Validation Without Workspace (Priority: P2)

The "Test Connection" feature in settings currently requires a valid workspace because it calls a workspace-scoped endpoint. It should validate only the server URL and API key by calling the project listing endpoint instead, allowing users to test their connection before selecting a workspace.

**Why this priority**: Directly supports the decoupled connection model and improves the settings UX. Without this, test connection fails misleadingly when no workspace is configured.

**Independent Test**: Can be tested by entering a valid URL and API key with no workspace selected, clicking Test Connection, and verifying a success message appears.

**Acceptance Scenarios**:

1. **Given** valid URL and API key are entered but no workspace is selected, **When** the user clicks Test Connection, **Then** the connection is validated successfully using the project listing endpoint.
2. **Given** an invalid API key is entered, **When** the user clicks Test Connection, **Then** an error message indicates the credentials are invalid.

---

### Edge Cases

- **Insufficient permissions**: User's API key is valid but lacks permission to list projects. The extension displays a clear error suggesting the user check their permissions.
- **Workspace deleted externally**: The active workspace is deleted from the web UI or another client. Session polling starts returning errors. The extension detects this and prompts the user to select a different workspace.
- **Non-active workspace status**: Workspaces with "pending" or "archived" status are shown in the list with a status indicator. Selecting a non-active workspace displays a warning.
- **Network failure during wizard**: If the network drops during any wizard step, a retry option is shown. Previously entered data (URL, API key) is preserved.
- **Concurrent config changes**: If multiple browser windows/tabs have the extension open, config changes made in one propagate to others via storage change listeners.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to connect (validate credentials) using only a server URL and API key, without requiring a workspace name.
- **FR-002**: System MUST display a guided setup wizard when no valid configuration exists (no API key or no workspace selected).
- **FR-003**: System MUST fetch and display the list of available workspaces from the server after successful credential validation.
- **FR-004**: System MUST allow users to create a new workspace by providing a name, display name, and optional description.
- **FR-005**: System MUST allow users to select a workspace from the available list to set as the active workspace.
- **FR-006**: System MUST replace the workspace text input in settings with a dropdown populated from the server's workspace list.
- **FR-007**: System MUST allow users to delete a workspace after confirming the action by typing the workspace name.
- **FR-008**: System MUST refresh all session data when the active workspace changes.
- **FR-009**: System MUST gracefully handle missing workspace configuration by not polling for sessions until a workspace is selected.
- **FR-010**: System MUST validate connections using an endpoint that does not require a workspace, replacing the current workspace-scoped validation.
- **FR-011**: System MUST preserve user-entered data across error states (failed connections, failed workspace creation) so users don't have to re-enter information.
- **FR-012**: System MUST display workspace status (active, pending, archived) in the workspace list.
- **FR-013**: System MUST clear the active workspace and prompt for re-selection when the active workspace is deleted.

### Key Entities

- **Workspace**: Represents a project/namespace on the ACP server. Has a unique name (slug), display name, description, creation timestamp, and status (active/archived/pending). Users can belong to multiple workspaces.
- **Connection**: Represents the server URL and API key pair used to authenticate with ACP. Independent of workspace selection.
- **Configuration**: The stored state consisting of server URL, API key, and optionally a selected workspace name. Determines what the extension displays on load.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New users can go from extension install to viewing their first session list in under 2 minutes, without leaving the extension.
- **SC-002**: 100% of extension functionality remains accessible after selecting a workspace — no regressions from the current experience.
- **SC-003**: Users can switch between workspaces in under 5 seconds (select from dropdown, sessions refresh).
- **SC-004**: Zero data loss during error states — all user-entered form data is preserved when errors occur during connection or workspace creation.
- **SC-005**: The extension operates in a connected-but-no-workspace state without errors or unnecessary background activity.

## Assumptions

- Users have a valid ACP server URL and API key before using the extension. The extension does not handle user registration or key generation.
- The server's project listing endpoint returns all workspaces accessible to the authenticated user. No client-side permission filtering is needed beyond what the server provides.
- Workspace names follow slug conventions (lowercase, alphanumeric, hyphens). The server validates name format on creation.
- The extension only supports one active workspace at a time. Multi-workspace views (e.g., sessions across workspaces) are out of scope.
- Workspace deletion is a permanent, irreversible action handled entirely by the server. The extension does not need to manage soft-delete or recovery.
- The existing session management, chat, and create-session flows remain unchanged once a workspace is selected.
