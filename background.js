importScripts('utils.js', 'oauth.js', 'api-client.js');

let pollTimer = null;
const POLL_NORMAL = 15000;
const POLL_FAST = 3000;
let currentPollInterval = POLL_NORMAL;
const sseControllers = new Map();
const lastKnownPhases = new Map();
let fastPollTimeout = null;

function broadcast(message) {
  try {
    chrome.runtime.sendMessage(message);
  } catch (_) {}
}

let polling = false;
let cachedSessionsLocal = [];

async function pollSessions() {
  if (polling) return;
  polling = true;
  try {
    await _pollSessionsInner();
  } finally {
    polling = false;
  }
}

async function _pollSessionsInner() {
  if (!(await isAuthenticated())) return;

  const { projectName } = await getConfig();
  if (!projectName) return;

  let data;
  try {
    data = await api.sessions.list({ size: 100 });
  } catch (err) {
    if (err.status === 401 || /auth|unauthorized|expired/i.test(err.message)) {
      broadcast({ type: 'AUTH_EXPIRED' });
      stopPolling();
      return;
    }
    console.warn('pollSessions failed:', err);
    return;
  }

  const sessions = data.items || [];
  cachedSessionsLocal = sessions;

  const changed = JSON.stringify(sessions) !== JSON.stringify(
    (await chrome.storage.local.get('cachedSessions')).cachedSessions || []
  );
  await chrome.storage.local.set({ cachedSessions: sessions });
  if (changed) {
    broadcast({ type: 'SESSIONS_UPDATED', sessions });
  }

  for (const s of sessions) {
    lastKnownPhases.set(s.id, s.phase);
  }

  const activeIds = new Set();
  for (const s of sessions) {
    if (s.phase === 'Running' || s.phase === 'Creating') {
      activeIds.add(s.id);
      if (!sseControllers.has(s.id)) {
        connectSSE(s.id);
      }
    }
  }
  for (const id of sseControllers.keys()) {
    if (!activeIds.has(id)) {
      disconnectSSE(id);
    }
  }

  const needsFast = sessions.some(s =>
    s.phase === 'Creating' || s.phase === 'Pending' || s.phase === 'Stopping'
  );
  const desired = needsFast ? POLL_FAST : POLL_NORMAL;
  if (desired !== currentPollInterval) {
    currentPollInterval = desired;
    restartTimer();
  }
}


const sseBackoff = new Map();

async function connectSSE(sessionId) {
  if (sseControllers.has(sessionId)) return;

  const controller = new AbortController();
  sseControllers.set(sessionId, controller);

  let response;
  try {
    response = await api.sessions.streamEvents(sessionId);
    sseBackoff.delete(sessionId);
  } catch (err) {
    sseControllers.delete(sessionId);
    if (/auth|expired|unauthorized/i.test(err.message)) {
      stopPolling();
      return;
    }
    console.warn(`SSE connect failed for ${sessionId}:`, err);
    scheduleSSEReconnect(sessionId);
    return;
  }

  parseSSEStream(
    response,
    (event) => {
      handleSSEEvent(sessionId, event);
      broadcast({ type: 'SSE_EVENT', sessionId, event });
    },
    (err) => {
      if (controller.signal.aborted) return;
      sseControllers.delete(sessionId);
      if (/auth|expired|unauthorized/i.test(String(err))) {
        stopPolling();
        return;
      }
      console.warn(`SSE error for ${sessionId}:`, err);
      scheduleSSEReconnect(sessionId);
    },
    controller.signal
  );
}

function scheduleSSEReconnect(sessionId) {
  const current = sseBackoff.get(sessionId) || 1000;
  const delay = Math.min(current, 30000) * (0.5 + Math.random());
  sseBackoff.set(sessionId, current * 2);
  setTimeout(() => {
    if (!sseControllers.has(sessionId)) {
      connectSSE(sessionId);
    }
  }, delay);
}

function disconnectSSE(sessionId) {
  const controller = sseControllers.get(sessionId);
  if (controller) {
    controller.abort();
  }
  sseControllers.delete(sessionId);
}

async function handleSSEEvent(sessionId, event) {
  const type = event.event_type || '';
  const match = cachedSessionsLocal.find(s => s.id === sessionId);
  const sessionName = match?.name || sessionId;

  if (/TOOL_CALL_START/i.test(type)) {
    const toolName = event.tool_name || event.name || '';
    if (/ask.*user|user.*question|askuserquestion/i.test(toolName)) {
      createNotification(sessionId, 'input_needed',
        'Input Needed',
        `Session "${sessionName}" is waiting for your input`
      );
    }
  }

  if (type === 'RUN_FINISHED') {
    createNotification(sessionId, 'run_finished',
      'Run Finished',
      `Session "${sessionName}" completed`
    );
    pollSessions();
  }

  if (type === 'RUN_ERROR') {
    const msg = event.error || event.message || 'An error occurred';
    createNotification(sessionId, 'error',
      'Run Error',
      `Session "${sessionName}": ${msg}`
    );
  }
}

async function createNotification(sessionId, kind, title, body) {
  const { notifications = [] } = await chrome.storage.local.get('notifications');

  notifications.push({
    id: Date.now(),
    read: false,
    ts: new Date().toISOString(),
    sessionId,
    kind,
    title,
    body,
  });

  while (notifications.length > 50) {
    notifications.shift();
  }

  await chrome.storage.local.set({ notifications });

  const unread = notifications.filter(n => !n.read).length;
  chrome.action.setBadgeText({ text: unread > 0 ? String(unread) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });

  broadcast({ type: 'NOTIFICATION_ADDED' });
}

function restartTimer() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollSessions, currentPollInterval);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollSessions();
  pollTimer = setInterval(pollSessions, currentPollInterval);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  for (const id of sseControllers.keys()) {
    disconnectSSE(id);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_NOTIFICATIONS': {
      chrome.storage.local.get('notifications').then(({ notifications = [] }) => {
        sendResponse({ notifications });
      });
      return true;
    }

    case 'MARK_ALL_READ': {
      chrome.storage.local.get('notifications').then(async ({ notifications = [] }) => {
        for (const n of notifications) n.read = true;
        await chrome.storage.local.set({ notifications });
        chrome.action.setBadgeText({ text: '' });
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'REFRESH_SESSIONS': {
      pollSessions().then(() => sendResponse({ ok: true }));
      return true;
    }

    case 'SESSION_TRANSITIONING': {
      currentPollInterval = POLL_FAST;
      restartTimer();
      if (fastPollTimeout) clearTimeout(fastPollTimeout);
      fastPollTimeout = setTimeout(() => {
        currentPollInterval = POLL_NORMAL;
        restartTimer();
        fastPollTimeout = null;
      }, 30000);
      sendResponse({ ok: true });
      return false;
    }

    case 'OAUTH_LOGIN': {
      oauthLogin(msg.serverUrl, msg.issuerUrl)
        .then((result) => {
          sendResponse({ ok: true, result });
          startPolling();
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message || String(err) });
        });
      return true;
    }

    case 'OAUTH_LOGOUT': {
      oauthLogout()
        .then(async () => {
          stopPolling();
          await chrome.storage.local.remove('cachedSessions');
          sendResponse({ ok: true });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message || String(err) });
        });
      return true;
    }
  }
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

(async () => {
  if (await isAuthenticated()) {
    const { projectName } = await getConfig();
    if (projectName) {
      startPolling();
    }
  }
})();
