# ACP Browser Extension

Chrome extension for monitoring and interacting with [Ambient Code Platform](https://github.com/ambient-code) agentic sessions from your browser.

- View and manage running sessions
- Chat with agents in real time (streaming via SSE)
- Create new sessions with workflow and model selection
- Get notified when an agent needs input or finishes a run

## Quickstart

1. Clone the repo:
   ```bash
   git clone https://github.com/ambient-code/browser-extension.git
   ```

2. Open Chrome and navigate to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the cloned `browser-extension` directory

5. Click the extension icon in the toolbar, then open the **side panel**

6. Go to **Settings** and configure:
   - **Base URL** — your ACP backend (e.g. `https://acp.example.com`)
   - **API Key** — your ACP API key
   - **Project** — project name (defaults to `default`)

7. Click **Test Connection** to verify, then start managing your sessions
