# Quickstart: Workspace Management & Guided Setup

## Development Setup

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `browser-extension/` directory
4. Open any page and click the extension icon to open the side panel

## Testing the Feature

### First-Time Setup Wizard

1. Clear extension storage: open DevTools on the side panel → Application → Storage → Clear site data
2. Close and reopen the side panel
3. The setup wizard should appear (Step 1: Connect)
4. Enter a valid ACP Base URL and API Key
5. Click Connect — should validate and advance to Step 2
6. Step 2 shows available workspaces or prompts to create one
7. Select or create a workspace — wizard closes, sessions list loads

### Workspace CRUD in Settings

1. Click the Settings gear icon
2. The "Project / Namespace" text input is now a dropdown populated with workspaces
3. Switch workspace: select a different workspace from the dropdown
4. Create workspace: click "Create Workspace", fill in name + display name, submit
5. Delete workspace: click "Delete", type workspace name to confirm, submit

### Connection Test Without Workspace

1. Open Settings
2. Clear the workspace selection
3. Click "Test Connection" — should succeed with just URL + API key

### Edge Cases to Verify

- Enter invalid credentials in the wizard → error shown, data preserved
- Delete the active workspace → prompted to select another
- Open extension with no network → retry button shown
- Multiple tabs with extension open → config changes propagate

## Files Modified

| File | What Changed |
|------|-------------|
| `utils.js` | `getConfig()` defaults projectName to `''` instead of `'default'` |
| `sidepanel.html` | Added wizard overlay HTML, restructured settings workspace section |
| `sidepanel.js` | Added wizard flow, workspace CRUD functions, workspace selector |
| `background.js` | Added `!projectName` guard to polling and SSE |
| `styles.css` | Added wizard overlay and workspace management styles |
