# Data Model: Workspace Management & Guided Setup

## Entities

### Workspace (AmbientProject)

Represents a project/namespace on the ACP server. Returned by `GET /api/projects`.

| Field | Type | Description |
|-------|------|-------------|
| name | string | Unique identifier (slug format: lowercase, alphanumeric, hyphens) |
| displayName | string | Human-readable name |
| description | string | Optional description |
| labels | object | Key-value pairs for metadata |
| annotations | object | Key-value pairs for annotations |
| creationTimestamp | string (RFC3339) | When the workspace was created |
| status | enum: active, archived, pending | Current workspace state |
| isOpenShift | boolean | Whether workspace is on OpenShift |

**Create request fields**:
| Field | Type | Required |
|-------|------|----------|
| name | string | Yes |
| displayName | string | Yes |
| description | string | No |
| labels | object | No |

### Configuration (chrome.storage.local)

Local extension state that persists across sessions.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| baseUrl | string | `'http://localhost:8080'` | ACP server URL |
| apiKey | string | `''` | Bearer token for authentication |
| projectName | string | `''` (changed from `'default'`) | Active workspace name |
| cachedSessions | array | `[]` | Cached session list from last poll |
| notifications | array | `[]` | Notification history |
| theme | string | `'dark'` | UI theme preference |

**State transitions**:

```
No Config (apiKey='', projectName='')
    │
    ├── User enters URL + API key → Connected (apiKey set, projectName='')
    │       │
    │       ├── User selects workspace → Fully Configured (both set)
    │       │       │
    │       │       ├── User switches workspace → Fully Configured (new projectName)
    │       │       ├── User deletes active workspace → Connected (projectName cleared)
    │       │       └── User clears settings → No Config
    │       │
    │       └── User creates workspace → Fully Configured (both set)
    │
    └── Existing user with saved config → Fully Configured (both set)
```
