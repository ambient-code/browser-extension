let currentSession = null;
let activeSSEController = null;
let lastSeq = 0;

const CLIENT_VERSION = '0.2.0';

function extractClusterName(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname;
    const rosaMatch = hostname.match(/apps\.rosa\.([^.]+)\./);
    if (rosaMatch) return rosaMatch[1];
    const ocpMatch = hostname.match(/apps\.([^.]+)\./);
    if (ocpMatch) return ocpMatch[1];
    return hostname.split('.')[0];
  } catch (_) {
    return baseUrl || '';
  }
}

function updateConnectionStatus(state) {
  const el = document.getElementById('title-connection');
  if (!el) return;
  el.className = 'title-connection ' + state;
  const clusterEl = document.getElementById('title-cluster');
  const serverEl = document.getElementById('version-server');
  const clientEl = document.getElementById('version-client');
  if (state === 'disconnected') {
    if (clusterEl) clusterEl.textContent = '';
    if (serverEl) serverEl.textContent = '';
    if (clientEl) clientEl.textContent = '';
    return;
  }
  getConfig().then(cfg => {
    if (clusterEl) clusterEl.textContent = extractClusterName(cfg.baseUrl);
    if (serverEl) {
      serverEl.textContent = 'server:unknown';
      serverEl.title = `Click to copy: ${cfg.baseUrl}`;
    }
    if (clientEl) clientEl.textContent = `client:v${CLIENT_VERSION}`;
  });
}


function showWizard() {
  hideApp();
  document.getElementById('wizard').style.display = '';
}

function showApp() {
  document.getElementById('wizard').style.display = 'none';
  document.getElementById('title-bar').style.display = '';
  document.getElementById('app').style.display = '';
}

function hideApp() {
  document.getElementById('title-bar').style.display = 'none';
  document.getElementById('app').style.display = 'none';
}

function showPanel(panelId) {
  document.getElementById(panelId).classList.add('active');
}

function hidePanel(panelId) {
  document.getElementById(panelId).classList.remove('active');
}

function hidePanels() {
  document.querySelectorAll('.overlay-panel').forEach(p => p.classList.remove('active'));
}

async function populateProjectSelect(selectId, selectedName) {
  const data = await api.projects.list();
  const projects = data.items || [];
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  if (projects.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No workspaces — create one below';
    select.appendChild(opt);
  } else {
    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.displayName || p.name;
      if (p.name === selectedName) opt.selected = true;
      select.appendChild(opt);
    });
  }
  return projects;
}

async function loadWizardWorkspaces() {
  try {
    await populateProjectSelect('wizard-workspace');
  } catch (err) {
    showToast('Failed to load workspaces: ' + err.message, 'error');
  }
}

async function loadSessions() {
  const data = await chrome.storage.local.get('cachedSessions');
  const sessions = data.cachedSessions || [];
  renderSessions(sessions);
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
    if (resp?.ok) updateConnectionStatus('connected');
  } catch (_) {}
}

function renderSessions(sessions) {
  const list = document.getElementById('session-list');

  if (!sessions || sessions.length === 0) {
    list.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No sessions yet. Create one to get started.';
    list.appendChild(empty);
    return;
  }

  list.innerHTML = '';
  sessions.forEach(s => {
    const phaseLower = (s.phase || '').toLowerCase();

    const item = document.createElement('div');
    item.className = 'session-item';
    item.dataset.id = s.id;

    const info = document.createElement('div');
    info.className = 'session-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'session-name';
    nameEl.textContent = s.name;

    const meta = document.createElement('div');
    meta.className = 'session-meta';

    const badge = document.createElement('span');
    badge.className = 'phase-badge phase-' + phaseLower;
    badge.textContent = s.phase;

    const modelSpan = document.createElement('span');
    modelSpan.className = 'text-muted';
    modelSpan.textContent = s.llm_model || '';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'text-muted';
    timeSpan.textContent = timeAgo(s.created_at);

    meta.appendChild(badge);
    meta.appendChild(modelSpan);
    meta.appendChild(timeSpan);
    info.appendChild(nameEl);
    info.appendChild(meta);

    if (s.prompt) {
      const preview = document.createElement('div');
      preview.className = 'session-preview';
      preview.textContent = s.prompt;
      info.appendChild(preview);
    }

    const actions = document.createElement('div');
    actions.className = 'session-actions';

    if (s.phase === 'Running') {
      const chatBtn = document.createElement('button');
      chatBtn.className = 'btn btn-primary';
      chatBtn.textContent = 'Chat';
      chatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openChat(s);
      });
      actions.appendChild(chatBtn);

      const stopBtn = document.createElement('button');
      stopBtn.className = 'btn btn-secondary';
      stopBtn.textContent = 'Stop';
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        stopBtn.style.display = 'none';
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'btn btn-danger';
        confirmBtn.textContent = 'Stop?';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.textContent = 'No';
        confirmBtn.addEventListener('click', (e2) => {
          e2.stopPropagation();
          transitionSession(s.id, 'stop');
        });
        cancelBtn.addEventListener('click', (e2) => {
          e2.stopPropagation();
          confirmBtn.remove();
          cancelBtn.remove();
          stopBtn.style.display = '';
        });
        actions.appendChild(confirmBtn);
        actions.appendChild(cancelBtn);
      });
      actions.appendChild(stopBtn);
    } else if (s.phase === 'Stopped' || s.phase === 'Completed' || s.phase === 'Failed') {
      const startBtn = document.createElement('button');
      startBtn.className = 'btn btn-primary';
      startBtn.textContent = 'Start';
      startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        transitionSession(s.id, 'start');
      });
      actions.appendChild(startBtn);
    }

    item.appendChild(info);
    item.appendChild(actions);

    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openChat(s);
    });

    list.appendChild(item);
  });
}

async function transitionSession(id, action) {
  try {
    await api.sessions[action](id);
    try { chrome.runtime.sendMessage({ type: 'SESSION_TRANSITIONING' }); } catch (_) {}
    try { chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' }); } catch (_) {}
    loadSessions();
    const pastTense = action === 'stop' ? 'stopped' : 'started';
    showToast(`Session ${pastTense}`, 'success');
  } catch (err) {
    showToast(`Failed to ${action} session: ${err.message}`, 'error');
  }
}

function openChat(session) {
  currentSession = { id: session.id, name: session.name, phase: session.phase };

  document.getElementById('chat-title').textContent = session.name;

  const phaseEl = document.getElementById('chat-phase');
  phaseEl.textContent = session.phase;
  phaseEl.className = 'phase-badge phase-' + (session.phase || '').toLowerCase();

  document.getElementById('chat-messages').innerHTML = '';
  lastSeq = 0;

  showPanel('chat-panel');
  loadChatHistory(session.id);

  if (session.phase === 'Running') {
    connectChatSSE(session.id);
  }
}

async function loadChatHistory(sessionId) {
  const container = document.getElementById('chat-messages');
  const loading = document.createElement('div');
  loading.className = 'loading-indicator';
  loading.innerHTML = loadingDotsSVG();
  container.appendChild(loading);

  try {
    const messages = await api.sessions.listMessages(sessionId, 0);
    loading.remove();
    if (messages && messages.length > 0) {
      messages.forEach(msg => renderMessage(msg));
      lastSeq = Math.max(...messages.map(m => m.seq), 0);
    }
    scrollChatToBottom();
  } catch (err) {
    loading.remove();
    const errDiv = document.createElement('div');
    errDiv.className = 'empty-state';
    errDiv.textContent = 'Failed to load messages: ' + err.message;
    container.appendChild(errDiv);
  }
}

function renderMessage(msg) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');

  switch (msg.event_type) {
    case 'user':
      div.className = 'chat-bubble user';
      div.textContent = msg.payload;
      break;

    case 'assistant':
      div.className = 'chat-bubble assistant';
      div.textContent = msg.payload;
      break;

    case 'tool_use': {
      div.className = 'tool-call';
      const nameDiv = document.createElement('div');
      nameDiv.className = 'tool-call-name';
      nameDiv.textContent = msg.payload?.name || 'tool';
      const argsPre = document.createElement('pre');
      argsPre.className = 'tool-call-args';
      argsPre.textContent = typeof msg.payload?.arguments === 'string'
        ? msg.payload.arguments
        : JSON.stringify(msg.payload?.arguments, null, 2);
      div.appendChild(nameDiv);
      div.appendChild(argsPre);
      break;
    }

    case 'tool_result': {
      div.className = 'tool-call';
      const resultLabel = document.createElement('div');
      resultLabel.className = 'tool-call-name';
      resultLabel.textContent = 'Result';
      const resultPre = document.createElement('pre');
      resultPre.className = 'tool-call-args';
      resultPre.textContent = typeof msg.payload === 'string'
        ? msg.payload
        : JSON.stringify(msg.payload, null, 2);
      div.appendChild(resultLabel);
      div.appendChild(resultPre);
      break;
    }

    case 'error':
      div.className = 'chat-bubble error';
      div.textContent = typeof msg.payload === 'string'
        ? msg.payload
        : (msg.payload?.message || 'Error');
      break;

    case 'system':
      div.className = 'chat-bubble system';
      div.textContent = typeof msg.payload === 'string'
        ? msg.payload
        : JSON.stringify(msg.payload);
      break;

    default:
      div.className = 'chat-bubble system';
      div.textContent = typeof msg.payload === 'string'
        ? msg.payload
        : JSON.stringify(msg.payload);
      break;
  }

  container.appendChild(div);
  scrollChatIfAtBottom();
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}

function scrollChatIfAtBottom() {
  const container = document.getElementById('chat-messages');
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
  if (atBottom) {
    container.scrollTop = container.scrollHeight;
  }
}

let chatSSEBackoff = 1000;
let chatSSEReconnectTimer = null;

function connectChatSSE(sessionId) {
  if (activeSSEController) {
    activeSSEController.abort();
  }
  activeSSEController = new AbortController();
  chatSSEBackoff = 1000;
  const signal = activeSSEController.signal;

  (async () => {
    try {
      const response = await api.sessions.streamMessages(sessionId, lastSeq);
      chatSSEBackoff = 1000;
      await parseSSEStream(
        response,
        (msg) => {
          if (msg.seq > lastSeq) {
            renderMessage(msg);
            lastSeq = msg.seq;
          }
        },
        (err) => {
          if (signal.aborted) return;
          const delay = Math.min(chatSSEBackoff, 30000);
          chatSSEBackoff *= 2;
          chatSSEReconnectTimer = setTimeout(() => {
            chatSSEReconnectTimer = null;
            if (!signal.aborted && currentSession?.id === sessionId) {
              connectChatSSE(sessionId);
            }
          }, delay);
        },
        signal
      );
    } catch (err) {
      if (signal.aborted) return;
      showToast('SSE connection failed', 'error');
    }
  })();
}

function disconnectChatSSE() {
  if (chatSSEReconnectTimer) {
    clearTimeout(chatSSEReconnectTimer);
    chatSSEReconnectTimer = null;
  }
  if (activeSSEController) {
    activeSSEController.abort();
    activeSSEController = null;
  }
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  renderMessage({ event_type: 'user', payload: text, seq: lastSeq + 0.5 });

  try {
    await api.sessions.sendMessage(currentSession.id, text);
  } catch (err) {
    showToast('Failed to send message: ' + err.message, 'error');
    input.value = text;
  }
}

async function loadSettingsPanel() {
  const authenticated = await isAuthenticated();
  const authStatus = document.getElementById('auth-status');
  authStatus.innerHTML = '';

  if (authenticated) {
    const badge = document.createElement('span');
    badge.className = 'auth-user-badge';
    badge.textContent = 'Logged in';

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'btn btn-secondary';
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OAUTH_LOGOUT' });
      showWizard();
    });

    authStatus.appendChild(badge);
    authStatus.appendChild(logoutBtn);
  } else {
    const label = document.createElement('span');
    label.className = 'text-muted';
    label.textContent = 'Not logged in';

    const loginBtn = document.createElement('button');
    loginBtn.className = 'btn btn-primary';
    loginBtn.textContent = 'Login';
    loginBtn.addEventListener('click', () => {
      hidePanel('settings-panel');
      showWizard();
    });

    authStatus.appendChild(label);
    authStatus.appendChild(loginBtn);
  }

  const config = await getConfig();
  try {
    await populateProjectSelect('settings-workspace', config.projectName);
  } catch (_) {}

  document.getElementById('settings-server-url').textContent = config.baseUrl || 'Not set';

  const themeData = await chrome.storage.local.get('theme');
  const themeSelect = document.getElementById('settings-theme');
  if (themeSelect) {
    themeSelect.value = themeData.theme || 'dark';
  }
}

async function saveUrlToHistory(url) {
  const { urlHistory = [] } = await chrome.storage.local.get('urlHistory');
  const clean = url.replace(/\/+$/, '');
  if (!urlHistory.includes(clean)) {
    urlHistory.unshift(clean);
    await chrome.storage.local.set({ urlHistory: urlHistory.slice(0, 10) });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const authenticated = await isAuthenticated();
  const config = await getConfig();

  // Populate URL history datalist
  const { urlHistory = [] } = await chrome.storage.local.get('urlHistory');
  const urlDatalist = document.getElementById('url-history');
  if (urlDatalist) {
    urlHistory.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      urlDatalist.appendChild(opt);
    });
  }
  if (config.baseUrl) {
    document.getElementById('wizard-url').value = config.baseUrl;
  }

  if (!authenticated) {
    updateConnectionStatus('disconnected');
    showWizard();
  } else if (!config.projectName) {
    updateConnectionStatus('connecting');
    showWizard();
    document.getElementById('wizard-step-1').classList.remove('active');
    document.getElementById('wizard-step-2').classList.add('active');
    loadWizardWorkspaces();
  } else {
    updateConnectionStatus('connecting');

    showApp();
    loadSessions();
  }

  // Wizard: Reset/logout from step 1
  document.getElementById('wizard-reset-1').addEventListener('click', async () => {
    await chrome.storage.local.remove(['oauthTokens', 'baseUrl', 'projectName', 'cachedSessions']);
    chrome.runtime.sendMessage({ type: 'OAUTH_LOGOUT' });
    document.getElementById('wizard-url').value = '';
    document.getElementById('wizard-token').value = '';
    document.getElementById('wizard-login-status').textContent = '';
    updateConnectionStatus('disconnected');
    showToast('Connection reset');
  });

  // Wizard: Back from step 2 to step 1 (logout)
  document.getElementById('wizard-back-to-login').addEventListener('click', async () => {
    await chrome.storage.local.remove(['oauthTokens', 'projectName', 'cachedSessions']);
    chrome.runtime.sendMessage({ type: 'OAUTH_LOGOUT' });
    document.getElementById('wizard-step-2').classList.remove('active');
    document.getElementById('wizard-step-1').classList.add('active');
    updateConnectionStatus('disconnected');
  });

  // Wizard Step 1: Login
  document.getElementById('wizard-login-btn').addEventListener('click', async () => {
    const urlInput = document.getElementById('wizard-url');
    const url = urlInput.value.trim();
    const status = document.getElementById('wizard-login-status');

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      status.textContent = 'URL must start with http:// or https://';
      status.className = 'status-error';
      return;
    }

    status.textContent = 'Connecting...';
    status.className = 'status-info';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'OAUTH_LOGIN', serverUrl: url });
      if (response.error) {
        status.textContent = response.error;
        status.className = 'status-error';
        return;
      }
      await saveUrlToHistory(url);
      status.textContent = '';
      document.getElementById('wizard-step-1').classList.remove('active');
      document.getElementById('wizard-step-2').classList.add('active');
      await loadWizardWorkspaces();
    } catch (err) {
      status.textContent = 'Connection failed: ' + err.message;
      status.className = 'status-error';
    }
  });

  // Wizard: Manual token login
  document.getElementById('wizard-token-btn').addEventListener('click', async () => {
    const urlInput = document.getElementById('wizard-url');
    const tokenInput = document.getElementById('wizard-token');
    const url = urlInput.value.trim();
    const token = tokenInput.value.trim();

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      showToast('URL must start with http:// or https://', 'error');
      return;
    }
    if (!token) {
      showToast('Token is required', 'error');
      return;
    }

    await saveUrlToHistory(url);
    await chrome.storage.local.set({
      baseUrl: url.replace(/\/+$/, ''),
      oauthTokens: {
        access_token: token,
        refresh_token: null,
        expires_at: Date.now() + 86400000,
        issuer_url: null,
      },
    });

    try {
      await api.projects.list();
    } catch (err) {
      await chrome.storage.local.remove('oauthTokens');
      showToast('Token rejected by server: ' + (err.message || 'invalid'), 'error');
      return;
    }

    document.getElementById('wizard-step-1').classList.remove('active');
    document.getElementById('wizard-step-2').classList.add('active');
    await loadWizardWorkspaces();
  });

  // Wizard Step 2: Create workspace
  document.getElementById('wizard-create-workspace-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('wizard-new-workspace');
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      await api.projects.create({ name });
      nameInput.value = '';
      await loadWizardWorkspaces();
      document.getElementById('wizard-workspace').value = name;
    } catch (err) {
      showToast('Failed to create workspace: ' + err.message, 'error');
    }
  });

  // Wizard Step 2: Go button
  document.getElementById('wizard-go-btn').addEventListener('click', async () => {
    const projectName = document.getElementById('wizard-workspace').value;
    if (!projectName) {
      showToast('Select a workspace first', 'warning');
      return;
    }
    await chrome.storage.local.set({ projectName });
    updateConnectionStatus('connecting');

    showApp();
    chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
    loadSessions();
  });

  // Title bar: server version click → copy hostname
  document.getElementById('version-server').addEventListener('click', async () => {
    const cfg = await getConfig();
    if (cfg.baseUrl) {
      await navigator.clipboard.writeText(cfg.baseUrl);
      showToast('Server URL copied to clipboard');
    }
  });

  // Title bar: client version click → open GitHub
  document.getElementById('version-client').addEventListener('click', () => {
    window.open('https://github.com/ambient-code/browser-extension', '_blank');
  });

  // Title bar: help button → open docs
  document.getElementById('btn-help').addEventListener('click', () => {
    window.open('https://github.com/ambient-code/browser-extension#readme', '_blank');
  });

  // Create session panel
  document.getElementById('create-submit').addEventListener('click', async () => {
    const name = document.getElementById('create-name').value.trim();
    const prompt = document.getElementById('create-prompt').value.trim();
    const repo = document.getElementById('create-repo').value.trim();
    const model = document.getElementById('create-model').value.trim();

    if (!name) {
      showToast('Session name is required', 'warning');
      return;
    }

    const cfg = await getConfig();
    try {
      await api.sessions.create({
        name,
        prompt: prompt || undefined,
        project_id: cfg.projectName,
        repo_url: repo || undefined,
        llm_model: model || undefined,
      });
      if (repo) {
        const { repoHistory = [] } = await chrome.storage.local.get('repoHistory');
        if (!repoHistory.includes(repo)) {
          repoHistory.unshift(repo);
          await chrome.storage.local.set({ repoHistory: repoHistory.slice(0, 20) });
        }
      }
      hidePanel('create-panel');
      showToast('Session created');
      chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
      loadSessions();
    } catch (err) {
      showToast('Failed to create session: ' + err.message, 'error');
    }
  });

  document.getElementById('create-back').addEventListener('click', () => {
    hidePanel('create-panel');
  });

  // Toolbar
  document.getElementById('btn-create').addEventListener('click', async () => {
    const { repoHistory = [] } = await chrome.storage.local.get('repoHistory');
    const datalist = document.getElementById('repo-history');
    datalist.innerHTML = '';
    repoHistory.forEach(url => {
      const opt = document.createElement('option');
      opt.value = url;
      datalist.appendChild(opt);
    });
    showPanel('create-panel');
  });

  document.getElementById('btn-settings').addEventListener('click', () => {
    loadSettingsPanel();
    showPanel('settings-panel');
  });

  document.getElementById('btn-refresh').addEventListener('click', () => {
    loadSessions();
  });

  // Chat controls
  document.getElementById('chat-back').addEventListener('click', () => {
    disconnectChatSSE();
    hidePanel('chat-panel');
    currentSession = null;
  });

  document.getElementById('chat-send').addEventListener('click', sendMessage);

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Settings controls
  document.getElementById('settings-back').addEventListener('click', () => {
    hidePanel('settings-panel');
  });

  document.getElementById('settings-workspace').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ projectName: e.target.value });
    chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
    loadSessions();
  });

  document.getElementById('settings-create-workspace').addEventListener('click', async () => {
    const nameInput = document.getElementById('settings-new-workspace');
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      await api.projects.create({ name });
      nameInput.value = '';
      await loadSettingsPanel();
      document.getElementById('settings-workspace').value = name;
      await chrome.storage.local.set({ projectName: name });
      chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
      loadSessions();
    } catch (err) {
      showToast('Failed to create workspace: ' + err.message, 'error');
    }
  });

  document.getElementById('settings-delete-workspace').addEventListener('click', async function handler() {
    const btn = this;
    const select = document.getElementById('settings-workspace');
    const name = select.value;
    if (!name) return;
    if (btn.dataset.confirming !== 'true') {
      btn.dataset.confirming = 'true';
      btn.textContent = `Confirm delete "${name}"?`;
      setTimeout(() => {
        btn.dataset.confirming = '';
        btn.textContent = 'Delete Current Workspace';
      }, 3000);
      return;
    }
    btn.dataset.confirming = '';
    btn.textContent = 'Delete Current Workspace';
    try {
      await api.projects.delete(name);
      await loadSettingsPanel();
      const remaining = document.getElementById('settings-workspace');
      if (remaining.options.length === 0) {
        await chrome.storage.local.set({ projectName: '' });
        showWizard();
      } else {
        await chrome.storage.local.set({ projectName: remaining.value });
        chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
        loadSessions();
      }
    } catch (err) {
      showToast('Failed to delete workspace: ' + err.message, 'error');
    }
  });

  const themeSelect = document.getElementById('settings-theme');
  if (themeSelect) {
    themeSelect.addEventListener('change', async (e) => {
      const theme = e.target.value;
      await chrome.storage.local.set({ theme });
      document.documentElement.dataset.theme = theme;
    });
  }

  // Background message listener
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'SESSIONS_UPDATED':
        updateConnectionStatus('connected');
        renderSessions(msg.sessions);
        break;
      case 'SSE_EVENT':
        if (msg.sessionId === currentSession?.id && msg.data?.seq > lastSeq) {
          renderMessage(msg.data);
          lastSeq = msg.data.seq;
        }
        break;
      case 'AUTH_EXPIRED':
        updateConnectionStatus('error');
        showToast('Session expired, please log in again', 'error');
        chrome.storage.local.remove('oauthTokens');
        document.getElementById('wizard-step-2').classList.remove('active');
        document.getElementById('wizard-step-1').classList.add('active');
        showWizard();
        break;
      case 'NOTIFICATION_ADDED':
        break;
    }
  });
});
