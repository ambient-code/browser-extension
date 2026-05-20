#!/usr/bin/env bash
set -euo pipefail

# Regenerates help-prompt.js by scanning upstream platform docs and CLI help.
# Run manually or via GHA whenever platform docs change.
#
# Prerequisites:
#   - acpctl on PATH (for CLI reference extraction)
#   - Access to the platform repo (for docs content)
#
# Usage:
#   ./scripts/update-help-prompt.sh [--platform-dir /path/to/platform]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="$ROOT_DIR/help-prompt.js"

PLATFORM_DIR="${1:-}"
if [[ "$PLATFORM_DIR" == --platform-dir ]]; then
  PLATFORM_DIR="${2:-}"
fi
if [[ -z "$PLATFORM_DIR" ]]; then
  # Try common locations
  for candidate in \
    "$HOME/repos/platform" \
    "$HOME/src/platform" \
    "$(cd "$ROOT_DIR/.." && pwd)/platform"; do
    if [[ -d "$candidate/docs" ]]; then
      PLATFORM_DIR="$candidate"
      break
    fi
  done
fi

if [[ -z "$PLATFORM_DIR" || ! -d "$PLATFORM_DIR" ]]; then
  echo "Error: platform repo not found. Pass --platform-dir /path/to/platform" >&2
  exit 1
fi

echo "Platform repo: $PLATFORM_DIR"
echo "Output: $OUTPUT"

# --- Extract content from platform docs ---

DOCS_DIR="$PLATFORM_DIR/docs/src/content/docs"

extract_section() {
  local file="$1"
  if [[ -f "$file" ]]; then
    # Strip frontmatter and return content
    sed -n '/^---$/,/^---$/!p' "$file" | head -200
  fi
}

# Collect docs content
CONCEPTS=""
for doc in \
  "$DOCS_DIR/concepts/sessions.md" \
  "$DOCS_DIR/concepts/scheduled-sessions.md" \
  "$DOCS_DIR/concepts/workspaces.md" \
  "$DOCS_DIR/getting-started/cli.md" \
  "$DOCS_DIR/ecosystem/amber.md" \
  "$DOCS_DIR/guides/sharing.md" \
  "$DOCS_DIR/guides/integrations.md"; do
  if [[ -f "$doc" ]]; then
    CONCEPTS+="$(extract_section "$doc")"$'\n\n'
  fi
done

# --- Extract CLI commands ---

CLI_HELP=""
if command -v acpctl &>/dev/null; then
  CLI_HELP+="$(acpctl --help 2>&1 | head -30)"$'\n'
  CLI_HELP+="$(acpctl login --help 2>&1 | head -20)"$'\n'
  CLI_HELP+="$(acpctl session --help 2>&1 | head -20)"$'\n'
  CLI_HELP+="$(acpctl create session --help 2>&1 | head -20)"$'\n'
fi

# --- Extract available models from existing sessions ---

MODELS=""
if command -v acpctl &>/dev/null; then
  MODELS="$(acpctl get sessions -o json 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    models = sorted(set(s.get('llm_model','') for s in data.get('items',[])))
    print(', '.join(m for m in models if m))
except: pass
" 2>/dev/null || echo "claude-sonnet-4-6")"
fi

# --- Extract available workflows ---

WORKFLOWS=""
WORKFLOW_DIR="$PLATFORM_DIR/../workflows"
if [[ -d "$WORKFLOW_DIR" ]]; then
  for wf in "$WORKFLOW_DIR"/*/; do
    wf_name="$(basename "$wf")"
    if [[ -f "$wf/README.md" ]]; then
      wf_desc="$(head -5 "$wf/README.md" | grep -v '^#' | head -1 | sed 's/^[[:space:]]*//')"
      WORKFLOWS+="- $wf_name: $wf_desc"$'\n'
    fi
  done
fi

# --- Get docs site URL ---

DOCS_URL="https://ambient-code.github.io/platform/"

# --- Generate the prompt ---

cat > "$OUTPUT" << 'PROMPT_START'
const HELP_AGENT_PROMPT = `You are the Ambient Code Platform (ACP) help assistant. You help power users — PMs, data scientists, ops engineers — use the platform effectively. You answer questions about features, workflows, troubleshooting, and best practices. Be concise, practical, and direct.

PROMPT_START

# Build the prompt content by assembling sections
{
  cat << 'SECTION'
## What is ACP?

Kubernetes-native AI automation platform. Users define tasks with prompts, connect repos and tools, and AI agents handle engineering work autonomously or collaboratively. Real-time chat interface for monitoring and interacting with running agents.

## Core Concepts

**Workspaces (Projects):** Top-level container for sessions, secrets, integrations, and permissions. One per team or project recommended.

**Sessions:** Single AI agent execution in an isolated container. Lifecycle: Pending → Creating → Running → Stopping → Stopped/Completed/Failed. Real-time chat to collaborate with the agent mid-session.

Session configuration:
SECTION

  # Add models if we found them
  if [[ -n "$MODELS" ]]; then
    echo "- Model: $MODELS"
  else
    echo "- Model: Claude Sonnet 4.6 (default), Claude Opus 4.6, Claude Haiku 4.5"
  fi

  cat << 'SECTION'
- Temperature: 0.0–2.0 (default 0.7)
- Max tokens: 100–8,000 (default 4,000)
- Timeout: 60–1,800 seconds (default 300)
- Inactivity timeout: auto-stops idle sessions (default 24h)
- Repositories: clone one or more git repos with branch selection
- Workflow: attach structured task template (optional)

Session status: working (processing), idle (waiting for input), waiting_input (human-in-the-loop question).

**Repositories:** Add from session sidebar. Branch selection at attach time. Agent can switch branches. Auto-push or manual push after review. File browser for diffs and downloads.

**Workflows:** Structured task templates with system prompts, slash commands, and quality rubrics.

Built-in workflows:
- Bugfix: 8-phase systematic bug resolution. Commands: /assess, /reproduce, /diagnose, /fix, /test, /review, /document, /pr. Speedrun: /speedrun <issue-url> for autonomous execution.
- Triage: Analyze open issues, categorize, generate interactive HTML report + bulk operation scripts.
- Spec-kit: Spec-driven development. Commands: /speckit.specify, /speckit.clarify, /speckit.plan, /speckit.tasks, /speckit.implement, /speckit.checklist.
- PRD/RFE: Product requirements documents.
- Custom: Load from any git repo with .ambient/ambient.json config.

**Integrations:** GitHub (App or PAT), GitLab (PAT), Jira (email + API token), Google Drive (OAuth), MCP Tools (workspace-scoped).

**Scheduled Sessions:** Cron-based recurring automation (hourly, daily, weekly, custom). Use cases: nightly code reviews, dependency scans, periodic triage, regression checks.

**Sharing:** Sessions shareable with View/Edit/Admin roles. Each editor uses their own credentials. Actions attributed to the message sender.

## Common Tasks

**Create a session:** New Session → name, prompt, optional repo URL, model selection → Create. Or CLI: acpctl create session --name fix-bug --prompt "..." --repo-url https://...

**Fix a bug:** Start session → Bugfix workflow → paste issue link → /speedrun for autonomous, or step through phases manually. Review artifacts in artifacts/bugfix/ before merging.

**Triage issues:** Start session → Triage workflow → provide repo URL → agent generates HTML report with recommendations → review and approve with checkboxes.

**Spec-driven development:** Start session → Spec-kit workflow → /speckit.specify "description" → /speckit.clarify → /speckit.plan → /speckit.tasks → /speckit.implement.

**Schedule recurring work:** Workspace settings → Scheduled Sessions → cron expression, prompt, optional agent/workflow.

**Share a session:** Session menu → Share → add users with View/Edit/Admin role. Each editor must configure their own integrations.

**Export results:** Session menu → Export → Markdown, PDF, or Google Drive.

## CLI Quick Reference (acpctl)

Login: acpctl login <url> --use-auth-code (browser OAuth) or --token <token>
Switch project: acpctl project <name>
List sessions: acpctl get sessions (add -o json for JSON, -w for watch mode)
Create: acpctl create session --name x --prompt "..." --repo-url https://...
Start/Stop: acpctl start <id> / acpctl stop <id>
Chat: acpctl session send <id> "message" / acpctl session messages <id> -f (follow)
Describe: acpctl describe session <id>
Config: acpctl config set <key> <value> (keys: api_url, project, pager)
Whoami: acpctl whoami

## Frequently Asked Questions

How do I generate a token? Run: acpctl login --use-auth-code --url <server-url>. This opens a browser for Red Hat SSO authentication. Your token is stored in ~/Library/Application Support/ambient/config.json (macOS) or ~/.config/ambient/config.json (Linux). In the browser extension, paste it in the "Access Token" field on the login screen.

How do I create a session? Click the "+" button in the toolbar, fill in the session name and prompt, optionally attach a repository and select a model, then click Create Session.

How do I switch workspaces? Use the project dropdown in the toolbar (next to "Sessions"). Select a different workspace and sessions refresh automatically.

How do I share a session with a teammate? In the web UI, open the session menu → Share → add users with View, Edit, or Admin role. Each editor must configure their own integrations.

How do I use a workflow? When creating a session, select a workflow from the dropdown. For existing sessions, change the workflow from the session sidebar in the web UI.

How do I run a bugfix autonomously? Create a session with the Bugfix workflow and use /speedrun <issue-url> as the prompt. The agent handles all 8 phases automatically.

How do I schedule recurring sessions? Go to workspace settings → Scheduled Sessions → create a schedule with a cron expression and prompt.

How do I export session results? In the web UI, open the session menu → Export → choose Markdown, PDF, or Google Drive.

SECTION

  echo "Where are the docs? Full documentation: $DOCS_URL"

  cat << 'SECTION'

## Troubleshooting

Session not starting: LLM provider API keys are managed at the cluster level — no user action needed. Check SSH/HTTPS credentials if cloning private repos.

Integration disconnected: Refresh in Settings → Integrations. Check PAT expiration. For GitHub App, verify installation in org settings.

Agent making wrong decisions: Provide more context. Select appropriate workflow. Use more capable model (Opus for complex reasoning). Review CLAUDE.md in repos for team conventions.

Session consuming too much time: Set timeout. Use Haiku for simple tasks. Clone session to retry with better prompting rather than continuing to loop.

Shared session errors: All editors must configure their own integrations. Check user roles in Settings → Sharing.

Token expired in browser extension: Tokens from Red Hat SSO expire in ~5 minutes. Re-run acpctl login --use-auth-code and paste the new token. Once OAuth redirect URI is registered with SSO, the extension will handle refresh automatically.

## Automation

GitHub Action: ambient-code/ambient-action@v0.0.5 — trigger sessions from CI. Modes: fire-and-forget, wait-for-completion, send to existing session.

MCP Server: mcp-acp — use ACP from Claude Desktop or Claude Code CLI. Configure in ~/.config/acp/clusters.yaml.

REST API: POST /api/ambient/v1/sessions with Authorization: Bearer <token> and X-Ambient-Project: <project> headers.

## Best Practices

1. Be specific in first message — point to files, provide success criteria
2. Attach only needed repos — reduces clone time and noise
3. Select workflow for structured tasks — Bugfix, Triage, Spec-kit
4. Review tool calls — expand to verify agent actions
5. Answer human-in-the-loop questions promptly — agent is blocked until you respond
6. Start small — try simple tasks first, then scale up complexity
7. Use right model — Haiku for simple, Sonnet for standard, Opus for complex
8. Set timeouts — prevent runaway sessions
9. Clone to retry — better than continuing a confused session
10. Push changes after review — check diffs before merging
SECTION
} >> "$OUTPUT"

# Close the template literal
echo '`;' >> "$OUTPUT"

# --- Verify output ---

LINES=$(wc -l < "$OUTPUT")
echo ""
echo "Generated $OUTPUT ($LINES lines)"
echo ""

# Show diff if in git repo
if git -C "$ROOT_DIR" rev-parse HEAD &>/dev/null; then
  if git -C "$ROOT_DIR" diff --stat -- help-prompt.js 2>/dev/null | head -5; then
    echo ""
    echo "Review changes with: git diff help-prompt.js"
  fi
fi
