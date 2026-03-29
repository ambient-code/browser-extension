// background.js — Service worker: manages SSE subscriptions, badge, notifications
// Manifest V3 service workers don't support ES module EventSource reliably,
// so we use fetch-based SSE parsing instead.

importScripts('utils.js');

// ---------- Polling config ----------
const POLL_INTERVAL_NORMAL = 15_000;   // 15s when all sessions are stable
const POLL_INTERVAL_FAST = 3_000;      // 3s when any session is transitioning
// Transitional phases that warrant faster polling
const TRANSITIONAL_PHASES = new Set(['Creating', 'Pending', 'Stopping']);

let pollTimer = null;
let currentPollInterval = POLL_INTERVAL_NORMAL;
let sseControllers = new Map(); // sessionName → AbortController
let lastKnownPhases = new Map(); // sessionName → phase (for change detection)

// ---------- Notification store ----------

async function getNotifications() {
  const { notifications = [] } = await chrome.storage.local.get('notifications');
  return notifications;
}

async function addNotification(notif) {
  const list = await getNotifications();
  list.unshift({ ...notif, id: Date.now(), read: false, ts: new Date().toISOString() });
  // Keep last 50
  const trimmed = list.slice(0, 50);
  await chrome.storage.local.set({ notifications: trimmed });
  await updateBadge();
  // Broadcast to popup / sidepanel
  chrome.runtime.sendMessage({ type: 'NOTIFICATION_ADDED', notification: trimmed[0] }).catch(() => {});
}

async function markAllRead() {
  const list = await getNotifications();
  list.forEach(n => n.read = true);
  await chrome.storage.local.set({ notifications: list });
  await updateBadge();
}

async function updateBadge() {
  const list = await getNotifications();
  const unread = list.filter(n => !n.read).length;
  const text = unread > 0 ? String(unread > 99 ? '99+' : unread) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: unread > 0 ? '#A3000F' : '#0C1014' });
}

// ---------- SSE per session ----------

async function connectSSE(sessionName) {
  if (sseControllers.has(sessionName)) return; // already connected

  const controller = new AbortController();
  sseControllers.set(sessionName, controller);

  const { baseUrl, apiKey, projectName } = await getConfig();
  const url = `${baseUrl}/api/projects/${projectName}/agentic-sessions/${sessionName}/agui/events`;

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok || !res.body) {
      sseControllers.delete(sessionName);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          handleSSEEvent(sessionName, event);
        } catch { /* skip */ }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`SSE error for ${sessionName}:`, err.message);
    }
  } finally {
    sseControllers.delete(sessionName);
  }
}

function disconnectSSE(sessionName) {
  const controller = sseControllers.get(sessionName);
  if (controller) {
    controller.abort();
    sseControllers.delete(sessionName);
  }
}

function handleSSEEvent(sessionName, event) {
  const type = event.type;

  // AskUserQuestion detection — tool call with name containing "ask" or "question"
  if (type === 'TOOL_CALL_START') {
    const toolName = event.toolCall?.name || event.name || '';
    if (/ask.*user|user.*question|askuserquestion/i.test(toolName)) {
      addNotification({
        sessionName,
        kind: 'input_needed',
        title: 'Input needed',
        body: `Session "${sessionName}" is waiting for your response.`,
      });
    }
  }

  // RUN_FINISHED and RUN_ERROR are phase transitions — trigger an immediate refresh
  // so the session list updates without waiting for the next poll cycle.
  if (type === 'RUN_FINISHED') {
    addNotification({
      sessionName,
      kind: 'run_finished',
      title: 'Run finished',
      body: `Session "${sessionName}" completed a run.`,
    });
    // Immediate refresh: session likely changed phase
    pollSessions();
  }

  if (type === 'RUN_ERROR') {
    const msg = event.error || event.message || 'Unknown error';
    addNotification({
      sessionName,
      kind: 'error',
      title: 'Error',
      body: `Session "${sessionName}": ${msg}`,
    });
    // Immediate refresh: session likely changed phase
    pollSessions();
  }

  // Forward all events to sidepanel
  chrome.runtime.sendMessage({
    type: 'SSE_EVENT',
    sessionName,
    event,
  }).catch(() => {});
}

// ---------- Adaptive polling ----------
// Drops to 3s when any session is in a transitional phase (Creating, Pending,
// Stopping), returns to 15s when all sessions are stable. Also detects phase
// changes between polls and pushes instant updates to the sidepanel.

function adjustPollInterval(sessions) {
  const hasTransitional = sessions.some(s => {
    const phase = s.status?.phase || s.phase || '';
    return TRANSITIONAL_PHASES.has(phase);
  });

  const desiredInterval = hasTransitional ? POLL_INTERVAL_FAST : POLL_INTERVAL_NORMAL;

  if (desiredInterval !== currentPollInterval) {
    currentPollInterval = desiredInterval;
    // Restart the timer with the new interval
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollSessions, currentPollInterval);
    console.log(`[ACP] Poll interval → ${currentPollInterval / 1000}s (transitional: ${hasTransitional})`);
  }
}

function detectPhaseChanges(sessions) {
  let changed = false;
  for (const s of sessions) {
    const name = s.metadata?.name || s.name;
    const phase = s.status?.phase || s.phase || '';
    const prev = lastKnownPhases.get(name);
    if (prev && prev !== phase) {
      changed = true;
      console.log(`[ACP] Phase change: ${name} ${prev} → ${phase}`);
    }
    lastKnownPhases.set(name, phase);
  }
  return changed;
}

// ---------- Session polling ----------

async function pollSessions() {
  try {
    const { baseUrl, apiKey, projectName } = await getConfig();
    if (!apiKey) return;

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/agentic-sessions?limit=100`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!res.ok) return;
    const data = await res.json();
    const sessions = data.items || data.sessions || data || [];

    // Detect phase changes before caching (side effect: updates lastKnownPhases)
    detectPhaseChanges(sessions);

    // Cache for sidepanel
    await chrome.storage.local.set({ cachedSessions: sessions });
    chrome.runtime.sendMessage({ type: 'SESSIONS_UPDATED', sessions }).catch(() => {});

    // Adaptive polling: speed up during transitions, slow down when stable
    adjustPollInterval(sessions);

    // Connect SSE to running sessions
    const runningSessions = new Set();
    for (const s of sessions) {
      const name = s.metadata?.name || s.name;
      const phase = s.status?.phase || s.phase || '';
      if (['Running', 'Creating'].includes(phase)) {
        runningSessions.add(name);
        connectSSE(name);
      }
    }

    // Disconnect SSE for sessions no longer running
    for (const name of sseControllers.keys()) {
      if (!runningSessions.has(name)) {
        disconnectSSE(name);
      }
    }
  } catch (err) {
    console.warn('pollSessions error:', err.message);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  currentPollInterval = POLL_INTERVAL_NORMAL;
  pollSessions();
  pollTimer = setInterval(pollSessions, currentPollInterval);
}

// ---------- Message handlers ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from our own extension context
  if (sender.id !== chrome.runtime.id) return;

  if (msg.type === 'MARK_ALL_READ') {
    markAllRead().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'GET_NOTIFICATIONS') {
    getNotifications().then(n => sendResponse(n));
    return true;
  }
  if (msg.type === 'REFRESH_SESSIONS') {
    pollSessions().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'CONNECT_SESSION_SSE') {
    connectSSE(msg.sessionName);
    sendResponse({ ok: true });
    return false;
  }
  // Trigger fast polling when user initiates a state transition (Start/Stop)
  if (msg.type === 'SESSION_TRANSITIONING') {
    if (currentPollInterval !== POLL_INTERVAL_FAST) {
      currentPollInterval = POLL_INTERVAL_FAST;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollSessions, POLL_INTERVAL_FAST);
      console.log('[ACP] Poll interval → 3s (user-initiated transition)');
    }
    sendResponse({ ok: true });
    return false;
  }
});

// ---------- Lifecycle ----------

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  startPolling();
});

// Open side panel on action click (right-click opens popup by default)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Start polling immediately when service worker loads
startPolling();
