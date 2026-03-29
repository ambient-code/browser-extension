# Implementation Plan: Workspace Management & Guided Setup

**Branch**: `001-workspace-management` | **Date**: 2026-03-28 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-workspace-management/spec.md`

## Summary

Add workspace CRUD operations and a guided setup wizard to the ACP browser extension. Decouple connection validation from workspace selection so users can connect with just a URL and API key, then discover/create/select workspaces. Replace the workspace text input in settings with a dynamic dropdown. All changes are within existing files — no new files needed.

## Technical Context

**Language/Version**: JavaScript (ES2020+, no modules)
**Primary Dependencies**: Chrome Extensions API (Manifest V3), no external libraries
**Storage**: `chrome.storage.local` for config persistence
**Testing**: Manual testing via Chrome extension reload (no test framework)
**Target Platform**: Chrome browser (Manifest V3 service worker + side panel)
**Project Type**: Browser extension (Chrome Manifest V3)
**Performance Goals**: Workspace list loads in <2s, switch completes in <5s
**Constraints**: No build step, no ES modules, vanilla JS only, `importScripts()` in service worker
**Scale/Scope**: Single active workspace, ~10-50 workspaces per user

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No project constitution has been defined (template is unfilled). No gates to check.

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-management/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
./
├── manifest.json        # Extension manifest (no changes needed)
├── background.js        # Service worker: guard polling on projectName
├── sidepanel.html       # Add wizard overlay HTML, restructure settings workspace section
├── sidepanel.js         # Wizard flow, workspace CRUD, modified settings, workspace selector
├── utils.js             # getConfig() default change
├── styles.css           # Wizard and workspace management styles
├── popup.js             # No changes
├── popup.html           # No changes
└── theme-init.js        # No changes
```

**Structure Decision**: Flat file structure at repo root. This is a no-build-step Chrome extension — all JS files are loaded directly via `<script>` tags or `importScripts()`. No new files are needed; all changes are modifications to existing files.

## Complexity Tracking

No constitution violations to justify.
