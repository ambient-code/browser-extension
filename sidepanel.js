// sidepanel.js — Main panel logic: sessions list, chat, create, settings, theme

// ========== State ==========
let currentSession = null;  // { name, displayName, phase }
let chatMessages = [];      // Rendered messages
let pendingInput = null;    // AskUserQuestion state
let currentTextBuffer = ''; // Accumulator for streaming text
let currentToolCall = null; // Accumulator for streaming tool call
let activeEventSource = null; // Live SSE connection for current chat

// ========== Theme ==========
function initTheme() {
  const saved = localStorage.getItem('acp-theme') || 'dark';
  applyTheme(saved);
  // Also persist to chrome.storage for popup access
  chrome.storage.local.set({ theme: saved });
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
  // Update toggle icon
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '\u2600' : '\u263E'; // sun / moon
  localStorage.setItem('acp-theme', theme);
  chrome.storage.local.set({ theme });
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(isDark ? 'light' : 'dark');
}

document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
initTheme();

// ========== Panel navigation (replaces tabs) ==========
function showPanel(panelId) {
  document.getElementById('sessions-panel').classList.toggle('hidden', panelId !== 'sessions');
  document.getElementById('create-panel').classList.toggle('active', panelId === 'create');
  document.getElementById('settings-panel').classList.toggle('active', panelId === 'settings');
}

document.getElementById('new-session-toggle').addEventListener('click', () => {
  showPanel('create');
  loadCreatePanelData();
});
document.getElementById('settings-toggle').addEventListener('click', () => showPanel('settings'));
document.getElementById('create-back-btn').addEventListener('click', () => showPanel('sessions'));
document.getElementById('settings-back-btn').addEventListener('click', () => showPanel('sessions'));

// ========== Sessions list ==========
async function loadSessions() {
  const listEl = document.getElementById('sessions-list');
  const loadingEl = document.getElementById('sessions-loading');
  const emptyEl = document.getElementById('sessions-empty');

  loadingEl.style.display = 'block';
  emptyEl.style.display = 'none';

  try {
    const { cachedSessions } = await chrome.storage.local.get('cachedSessions');
    const sessions = cachedSessions || [];
    if (sessions.length > 0) updateConnectionHealth();
    renderSessions(sessions);
    chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state"><div class="subtitle" style="color:var(--destructive)">Error: ${err.message}</div></div>`;
  } finally {
    loadingEl.style.display = 'none';
  }
}

function renderSessions(sessions) {
  const listEl = document.getElementById('sessions-list');
  const emptyEl = document.getElementById('sessions-empty');

  if (!sessions || sessions.length === 0) {
    listEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';

  const phaseOrder = { Running: 0, Creating: 1, Pending: 2, Stopping: 3, Stopped: 4, Completed: 5, Failed: 6 };
  sessions.sort((a, b) => {
    const pa = phaseOrder[getPhase(a)] ?? 9;
    const pb = phaseOrder[getPhase(b)] ?? 9;
    if (pa !== pb) return pa - pb;
    return (getCreationTime(b) || '').localeCompare(getCreationTime(a) || '');
  });

  listEl.innerHTML = sessions.map(s => {
    const name = getName(s);
    const display = getDisplayName(s);
    const phase = getPhase(s).toLowerCase();
    const prompt = getPrompt(s);
    const age = timeAgo(getCreationTime(s));

    return `
      <div class="session-item" data-name="${name}" data-display="${escHtml(display)}" data-phase="${phase}">
        <div class="session-status ${phase}"></div>
        <div class="session-info">
          <div class="session-name">${escHtml(display || name)}</div>
          <div class="session-meta">${escHtml(phase)} &middot; ${age}${prompt ? ' &middot; ' + escHtml(truncate(prompt, 50)) : ''}</div>
        </div>
        ${phase === 'running' ? `<div class="session-actions"><button class="session-action-btn stop" data-action="stop" data-name="${name}">Stop</button></div>` : ''}
        ${phase === 'stopped' || phase === 'completed' || phase === 'failed' ? `<div class="session-actions"><button class="session-action-btn start" data-action="start" data-name="${name}">Start</button></div>` : ''}
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.session-action-btn')) return;
      openChat(el.dataset.name, el.dataset.display, el.dataset.phase);
    });
  });

  listEl.querySelectorAll('.session-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const name = btn.dataset.name;
      const actionsContainer = btn.closest('.session-actions');

      // Replace button with transitioning label + loading dots
      const label = action === 'start' ? 'Starting' : 'Stopping';
      actionsContainer.innerHTML = `
        <span class="session-transitioning">
          ${label}
          ${loadingDotsSVG('small')}
        </span>`;

      try {
        const { baseUrl, apiKey, projectName } = await getConfig();
        await fetch(
          `${baseUrl}/api/projects/${projectName}/agentic-sessions/${name}/${action}`,
          { method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        // Tell background worker to switch to fast polling (3s) during transition
        chrome.runtime.sendMessage({ type: 'SESSION_TRANSITIONING' }).catch(() => {});
        // Also do an immediate refresh after a short delay for the API to register
        setTimeout(loadSessions, 1000);
      } catch (err) {
        showToast(`Error: ${err.message}`);
        loadSessions(); // Restore buttons
      }
    });
  });
}

// ========== Chat view ==========
function openChat(sessionName, displayName, phase) {
  currentSession = { name: sessionName, displayName, phase };
  chatMessages = [];
  pendingInput = null;
  currentTextBuffer = '';
  currentToolCall = null;

  // Close any existing SSE connection
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  document.getElementById('main-view').classList.add('hidden');
  document.getElementById('chat-view').classList.add('active');
  document.getElementById('chat-session-title').textContent = displayName || sessionName;

  const badge = document.getElementById('chat-phase-badge');
  badge.textContent = phase;
  badge.className = `phase-badge ${phase}`;

  document.getElementById('chat-messages').innerHTML = `
    <div class="loading-dots">${loadingDotsSVG('large')}</div>`;

  // Connect SSE for live events via background
  chrome.runtime.sendMessage({ type: 'CONNECT_SESSION_SSE', sessionName });

  // Load history via direct SSE connection
  loadChatHistory(sessionName);
}

function closeChat() {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  currentSession = null;
  chatMessages = [];
  pendingInput = null;
  document.getElementById('chat-view').classList.remove('active');
  document.getElementById('main-view').classList.remove('hidden');
  loadSessions();
}

document.getElementById('chat-back-btn').addEventListener('click', closeChat);

async function loadChatHistory(sessionName) {
  const container = document.getElementById('chat-messages');

  try {
    const { baseUrl, apiKey, projectName } = await getConfig();

    if (!apiKey) {
      container.innerHTML = '<div class="empty-state"><div class="subtitle" style="color:var(--destructive)">No API key configured. Check Settings.</div></div>';
      return;
    }

    const url = `${baseUrl}/api/projects/${projectName}/agentic-sessions/${sessionName}/agui/events`;

    // Strategy: use EventSource for history + live events in one connection.
    // SECURITY NOTE: EventSource doesn't support custom headers, so we pass
    // the token as a query param. The backend should treat ?token= as sensitive
    // and avoid logging it. HTTPS mitigates network-level exposure.
    const events = [];
    let historyLoaded = false;

    const sseUrl = `${url}?token=${encodeURIComponent(apiKey)}`;
    activeEventSource = new EventSource(sseUrl);

    // Collect events for up to 5 seconds, then render whatever we have
    const historyTimeout = setTimeout(() => {
      if (!historyLoaded) {
        historyLoaded = true;
        processHistory(events, sessionName);
      }
    }, 5000);

    activeEventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        updateConnectionHealth(); // Track SSE activity

        if (!historyLoaded) {
          events.push(event);

          // MESSAGES_SNAPSHOT means we have the full history — render now
          if (event.type === 'MESSAGES_SNAPSHOT') {
            clearTimeout(historyTimeout);
            historyLoaded = true;
            processHistory(events, sessionName);
          }
        } else {
          // Live event after history is loaded
          handleStreamEvent(event);
        }
      } catch (err) {
        console.warn('[ACP] Failed to parse SSE event:', err);
      }
    };

    activeEventSource.onerror = (e) => {
      console.warn('[ACP] EventSource error:', e);
      // If we haven't loaded history yet and the connection failed, show error
      if (!historyLoaded) {
        clearTimeout(historyTimeout);
        historyLoaded = true;
        container.innerHTML = '<div class="empty-state"><div class="subtitle" style="color:var(--destructive)">Connection lost. Check your settings and try again.</div></div>';
      }
    };

  } catch (err) {
    console.error('[ACP] loadChatHistory error:', err);
    container.innerHTML = `<div class="empty-state"><div class="subtitle" style="color:var(--destructive)">Failed to load: ${escHtml(err.message)}</div></div>`;
  }
}

function extractContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(p => p.type === 'text')
      .map(p => p.text || '')
      .join('\n') || '';
  }
  if (content && typeof content === 'object') {
    return content.text || '';
  }
  return '';
}

function processHistory(events, sessionName) {
  console.log(`[ACP] Processing ${events.length} history events for ${sessionName}`, events.map(e => e.type));

  const snapshot = events.find(e => e.type === 'MESSAGES_SNAPSHOT');
  if (snapshot && snapshot.messages) {
    chatMessages = snapshot.messages
      .filter(m => !m.metadata?.hidden)
      .map(m => ({
        role: m.role,
        content: extractContent(m.content),
        toolCalls: m.toolCalls,
        toolCallId: m.toolCallId,
      }))
      .filter(m => m.content && m.role !== 'tool');
  } else if (events.length > 0) {
    chatMessages = reconstructFromEvents(events);
  }

  renderChatMessages();
}

function reconstructFromEvents(events) {
  const messages = [];
  let currentMsg = null;
  let currentTool = null;

  for (const e of events) {
    switch (e.type) {
      case 'TEXT_MESSAGE_START':
        currentMsg = { role: e.role || 'assistant', content: '' };
        break;
      case 'TEXT_MESSAGE_CONTENT':
        if (currentMsg) currentMsg.content += (e.content || e.delta || '');
        break;
      case 'TEXT_MESSAGE_END':
        if (currentMsg && currentMsg.content.trim()) {
          messages.push(currentMsg);
        }
        currentMsg = null;
        break;
      case 'TOOL_CALL_START':
        currentTool = { role: 'tool_call', content: e.toolCall?.name || e.name || 'tool', args: '' };
        break;
      case 'TOOL_CALL_ARGS':
        if (currentTool) currentTool.args += (e.delta || e.args || '');
        break;
      case 'TOOL_CALL_END':
        if (currentTool) messages.push(currentTool);
        currentTool = null;
        break;
      case 'RUN_ERROR':
        messages.push({ role: 'error', content: e.error || e.message || 'Run error' });
        break;
    }
  }
  return messages;
}

function renderChatMessages() {
  const container = document.getElementById('chat-messages');
  if (chatMessages.length === 0) {
    // If session is running, show loading dots — agent may still be processing initial prompt
    const isRunning = currentSession && (currentSession.phase === 'running' || currentSession.phase === 'creating' || currentSession.phase === 'pending');
    if (isRunning) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="loading-dots">${loadingDotsSVG('large')}</div>
          <div class="subtitle">Agent is working...</div>
        </div>`;
    } else {
      container.innerHTML = '<div class="empty-state"><div class="subtitle">No messages yet. Send a prompt to start.</div></div>';
    }
    return;
  }

  container.innerHTML = chatMessages.map(m => {
    if (m.role === 'user') {
      return `<div class="message user">${escHtml(m.content)}</div>`;
    }
    if (m.role === 'loading') {
      return `<div class="loading-dots">${loadingDotsSVG('large')}</div>`;
    }
    if (m.role === 'tool_call') {
      return `<div class="message tool-call"><span class="tool-name">${escHtml(m.content)}</span></div>`;
    }
    if (m.role === 'error') {
      return `<div class="message error">${escHtml(m.content)}</div>`;
    }
    if (m.role === 'tool') return '';
    return `<div class="message assistant">${formatMarkdownLight(m.content || '')}</div>`;
  }).join('');

  if (pendingInput) {
    const banner = document.createElement('div');
    banner.className = 'input-waiting-banner';
    banner.innerHTML = `
      <div class="prompt-text">${escHtml(pendingInput.question || 'The agent needs your input')}</div>
      <div class="options">
        ${(pendingInput.options || []).map((opt, i) =>
          `<button class="option-btn" data-index="${i}" data-value="${escHtml(typeof opt === 'string' ? opt : opt.label || opt.value || '')}">${escHtml(typeof opt === 'string' ? opt : opt.label || opt.value || `Option ${i+1}`)}</button>`
        ).join('')}
      </div>
    `;
    banner.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sendChatMessage(btn.dataset.value);
        pendingInput = null;
        renderChatMessages();
      });
    });
    container.appendChild(banner);
  }

  container.scrollTop = container.scrollHeight;
}

// ========== Send message ==========
async function sendChatMessage(text) {
  if (!text.trim() || !currentSession) return;

  chatMessages.push({ role: 'user', content: text });
  chatMessages.push({ role: 'loading' }); // Show loading dots while waiting
  renderChatMessages();
  document.getElementById('chat-input').value = '';

  try {
    const { baseUrl, apiKey, projectName } = await getConfig();
    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/agentic-sessions/${currentSession.name}/agui/run`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }]
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`${res.status}: ${errText || res.statusText}`);
    }

    // The /agui/run response itself may be SSE — parse it
    if (res.body) {
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
            handleStreamEvent(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
    }
  } catch (err) {
    removeLoadingIndicator();
    chatMessages.push({ role: 'error', content: `Send failed: ${err.message}` });
    renderChatMessages();
  }
}

function removeLoadingIndicator() {
  chatMessages = chatMessages.filter(m => m.role !== 'loading');
}

function handleStreamEvent(event) {
  // Update connection health on any event
  updateConnectionHealth();

  switch (event.type) {
    case 'TEXT_MESSAGE_START':
      removeLoadingIndicator();
      currentTextBuffer = '';
      break;
    case 'TEXT_MESSAGE_CONTENT':
      currentTextBuffer += (event.content || event.delta || '');
      updateStreamingMessage(currentTextBuffer);
      break;
    case 'TEXT_MESSAGE_END':
      if (currentTextBuffer.trim()) {
        const existing = chatMessages[chatMessages.length - 1];
        if (existing && existing._streaming) {
          existing.content = currentTextBuffer;
          delete existing._streaming;
        } else {
          chatMessages.push({ role: 'assistant', content: currentTextBuffer });
        }
      }
      currentTextBuffer = '';
      renderChatMessages();
      break;
    case 'TOOL_CALL_START': {
      removeLoadingIndicator();
      const toolName = event.toolCall?.name || event.name || 'tool';
      currentToolCall = toolName;
      if (/ask.*user|user.*question|askuserquestion/i.test(toolName)) {
        pendingInput = { question: 'Agent is asking...', options: [] };
      }
      chatMessages.push({ role: 'tool_call', content: toolName });
      renderChatMessages();
      break;
    }
    case 'TOOL_CALL_ARGS':
      if (pendingInput && currentToolCall) {
        try {
          const args = JSON.parse(event.delta || event.args || '{}');
          if (args.question) pendingInput.question = args.question;
          if (args.questions && args.questions[0]) {
            pendingInput.question = args.questions[0].question || pendingInput.question;
            pendingInput.options = args.questions[0].options || [];
          }
          if (args.options) pendingInput.options = args.options;
          renderChatMessages();
        } catch { /* args arrive incrementally */ }
      }
      break;
    case 'TOOL_CALL_END':
      currentToolCall = null;
      renderChatMessages();
      break;
    case 'RUN_FINISHED':
      removeLoadingIndicator();
      updatePhaseBadge('completed');
      renderChatMessages();
      break;
    case 'RUN_ERROR':
      removeLoadingIndicator();
      chatMessages.push({ role: 'error', content: event.error || event.message || 'Run error' });
      updatePhaseBadge('failed');
      renderChatMessages();
      break;
    // Ignore MESSAGES_SNAPSHOT during live streaming (already loaded history)
  }
}

function updateStreamingMessage(text) {
  const last = chatMessages[chatMessages.length - 1];
  if (last && last._streaming) {
    last.content = text;
  } else {
    chatMessages.push({ role: 'assistant', content: text, _streaming: true });
  }
  renderChatMessages();
}

function updatePhaseBadge(phase) {
  const badge = document.getElementById('chat-phase-badge');
  badge.textContent = phase;
  badge.className = `phase-badge ${phase}`;
  if (currentSession) currentSession.phase = phase;
}

// ========== Send on Enter ==========
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage(e.target.value);
  }
});
document.getElementById('chat-send-btn').addEventListener('click', () => {
  sendChatMessage(document.getElementById('chat-input').value);
});

// Auto-resize textarea
document.getElementById('chat-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 120) + 'px';
});

// Auto-resize create chatbox textarea
document.getElementById('new-session-prompt').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 200) + 'px';
});

// ========== Create session: fetch runner types, models, workflows ==========
let cachedRunnerTypes = [];
let cachedModels = [];
let cachedWorkflows = [];

async function loadCreatePanelData() {
  try {
    const { baseUrl, apiKey, projectName } = await getConfig();
    if (!apiKey) return;
    const headers = { 'Authorization': `Bearer ${apiKey}` };

    // Fetch all three in parallel
    const [runnersRes, modelsRes, workflowsRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/projects/${projectName}/runner-types`, { headers }),
      fetch(`${baseUrl}/api/projects/${projectName}/models`, { headers }),
      fetch(`${baseUrl}/api/workflows/ootb?project=${projectName}`, { headers }),
    ]);

    // Runner types
    const runnerSelect = document.getElementById('new-session-runner');
    if (runnersRes.status === 'fulfilled' && runnersRes.value.ok) {
      const data = await runnersRes.value.json();
      cachedRunnerTypes = Array.isArray(data) ? data : (data.runnerTypes || []);
      runnerSelect.innerHTML = cachedRunnerTypes.map(r =>
        `<option value="${escHtml(r.id)}">${escHtml(r.displayName || r.id)}</option>`
      ).join('') || '<option value="">No runners</option>';
    } else {
      runnerSelect.innerHTML = '<option value="">Failed to load</option>';
    }

    // Models
    const modelSelect = document.getElementById('new-session-model');
    if (modelsRes.status === 'fulfilled' && modelsRes.value.ok) {
      const data = await modelsRes.value.json();
      cachedModels = data.models || [];
      const defaultModel = data.defaultModel || '';
      modelSelect.innerHTML = cachedModels.map(m =>
        `<option value="${escHtml(m.id)}" ${m.id === defaultModel ? 'selected' : ''}>${escHtml(m.label || m.id)}</option>`
      ).join('') || '<option value="">No models</option>';
    } else {
      modelSelect.innerHTML = '<option value="">Failed to load</option>';
    }

    // Workflows
    const workflowSelect = document.getElementById('new-session-workflow');
    if (workflowsRes.status === 'fulfilled' && workflowsRes.value.ok) {
      const data = await workflowsRes.value.json();
      cachedWorkflows = (data.workflows || []).filter(w => w.enabled !== false);
      workflowSelect.innerHTML = '<option value="">General chat</option>' +
        cachedWorkflows.map(w =>
          `<option value="${escHtml(w.id)}" data-git="${escHtml(w.gitUrl || '')}" data-branch="${escHtml(w.branch || 'main')}" data-path="${escHtml(w.path || '')}">${escHtml(w.name)}</option>`
        ).join('') +
        '<option value="__custom__">Custom workflow...</option>';
    } else {
      workflowSelect.innerHTML = '<option value="">General chat</option><option value="__custom__">Custom workflow...</option>';
    }
  } catch (err) {
    console.warn('[ACP] Failed to load create panel data:', err);
  }
}

// Filter models when runner changes (by provider)
document.getElementById('new-session-runner').addEventListener('change', () => {
  const runnerId = document.getElementById('new-session-runner').value;
  const runner = cachedRunnerTypes.find(r => r.id === runnerId);
  const provider = runner?.provider || '';
  const modelSelect = document.getElementById('new-session-model');

  const filtered = provider ? cachedModels.filter(m => m.provider === provider) : cachedModels;
  modelSelect.innerHTML = filtered.map(m =>
    `<option value="${escHtml(m.id)}">${escHtml(m.label || m.id)}</option>`
  ).join('') || '<option value="">No models for this runner</option>';
});

// Show/hide custom workflow fields
document.getElementById('new-session-workflow').addEventListener('change', () => {
  const val = document.getElementById('new-session-workflow').value;
  document.getElementById('custom-workflow-fields').style.display = val === '__custom__' ? 'block' : 'none';
});

// Create session
document.getElementById('create-session-btn').addEventListener('click', async () => {
  const prompt = document.getElementById('new-session-prompt').value.trim();
  const name = document.getElementById('new-session-name')?.value.trim() || '';
  const repo = document.getElementById('new-session-repo')?.value.trim() || '';
  const branch = document.getElementById('new-session-branch')?.value.trim() || '';
  const runnerType = document.getElementById('new-session-runner').value;
  const model = document.getElementById('new-session-model').value;
  const workflowVal = document.getElementById('new-session-workflow').value;
  const statusEl = document.getElementById('create-status');

  const btn = document.getElementById('create-session-btn');
  btn.disabled = true;
  statusEl.innerHTML = '<span style="color:var(--muted-foreground)">Creating...</span>';

  try {
    const { baseUrl, apiKey, projectName } = await getConfig();
    const body = {};
    if (name) body.displayName = name;
    if (prompt) body.initialPrompt = prompt;
    if (runnerType) body.runnerType = runnerType;
    if (model) body.llmSettings = { model };
    if (repo) {
      body.repos = [{ url: repo }];
      if (branch) body.repos[0].branch = branch;
    }

    // Workflow
    if (workflowVal === '__custom__') {
      const wfUrl = document.getElementById('new-session-workflow-url').value.trim();
      const wfBranch = document.getElementById('new-session-workflow-branch').value.trim() || 'main';
      if (wfUrl) {
        body.activeWorkflow = { gitUrl: wfUrl, branch: wfBranch };
      }
    } else if (workflowVal) {
      const selected = document.getElementById('new-session-workflow').selectedOptions[0];
      if (selected) {
        body.activeWorkflow = {
          gitUrl: selected.dataset.git,
          branch: selected.dataset.branch || 'main',
        };
        if (selected.dataset.path) body.activeWorkflow.path = selected.dataset.path;
      }
    }

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/agentic-sessions`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`${res.status}: ${errBody}`);
    }

    statusEl.innerHTML = '<span style="color:var(--status-success-fg)">Session created!</span>';
    document.getElementById('new-session-prompt').value = '';
    if (document.getElementById('new-session-name')) document.getElementById('new-session-name').value = '';
    if (document.getElementById('new-session-repo')) document.getElementById('new-session-repo').value = '';
    if (document.getElementById('new-session-branch')) document.getElementById('new-session-branch').value = '';

    setTimeout(() => {
      showPanel('sessions');
      loadSessions();
    }, 800);
  } catch (err) {
    statusEl.innerHTML = `<span style="color:var(--destructive)">${escHtml(err.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
});

// ========== Settings ==========
async function loadSettings() {
  const data = await chrome.storage.local.get(['baseUrl', 'apiKey', 'projectName']);
  document.getElementById('settings-url').value = data.baseUrl || '';
  document.getElementById('settings-apikey').value = data.apiKey || '';
  document.getElementById('settings-project').value = data.projectName || 'default';
}

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const baseUrl = document.getElementById('settings-url').value.trim();
  const apiKey = document.getElementById('settings-apikey').value.trim();
  const projectName = document.getElementById('settings-project').value.trim() || 'default';

  await chrome.storage.local.set({ baseUrl, apiKey, projectName });

  const statusEl = document.getElementById('settings-status');
  statusEl.innerHTML = '<span style="color:var(--status-success-fg)">Settings saved.</span>';
  setTimeout(() => { statusEl.innerHTML = ''; }, 2000);

  chrome.runtime.sendMessage({ type: 'REFRESH_SESSIONS' });
});

document.getElementById('test-connection-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('connection-status');
  statusEl.innerHTML = '<span style="color:var(--muted-foreground)">Testing...</span>';

  try {
    const baseUrl = document.getElementById('settings-url').value.trim().replace(/\/+$/, '');
    const apiKey = document.getElementById('settings-apikey').value.trim();
    const projectName = document.getElementById('settings-project').value.trim() || 'default';

    if (!baseUrl || !apiKey) throw new Error('Base URL and API Key are required.');

    await chrome.storage.local.set({ baseUrl, apiKey, projectName });
    document.getElementById('settings-status').innerHTML = '<span style="color:var(--status-success-fg)">Settings saved.</span>';
    setTimeout(() => { document.getElementById('settings-status').innerHTML = ''; }, 2000);

    const res = await fetch(
      `${baseUrl}/api/projects/${projectName}/agentic-sessions?limit=1`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    statusEl.innerHTML = '<span style="color:var(--status-success-fg)">Connected successfully!</span>';
  } catch (err) {
    statusEl.innerHTML = `<span style="color:var(--destructive)">Failed: ${escHtml(err.message)}</span>`;
  }
});

// ========== Background message handler ==========
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SESSIONS_UPDATED') {
    updateConnectionHealth(); // Background successfully polled
    renderSessions(msg.sessions);
  }
  if (msg.type === 'SSE_EVENT' && currentSession && msg.sessionName === currentSession.name) {
    // Skip if we already have a direct EventSource connection (avoid duplicate events)
    if (!activeEventSource) {
      handleStreamEvent(msg.event);
    }
  }
});

// ========== Utilities ==========
// getConfig(), escHtml(), timeAgo(), loadingDotsSVG() provided by utils.js

function getName(s) { return s.metadata?.name || s.name || 'unknown'; }
function getDisplayName(s) { return s.spec?.displayName || s.displayName || ''; }
function getPhase(s) { return s.status?.phase || s.phase || 'Pending'; }
function getPrompt(s) { return s.spec?.initialPrompt || s.initialPrompt || ''; }
function getCreationTime(s) { return s.metadata?.creationTimestamp || s.createdAt || ''; }

function truncate(str, len) {
  return str && str.length > len ? str.slice(0, len) + '...' : str;
}

function formatMarkdownLight(text) {
  return escHtml(text)
    .replace(/```[\s\S]*?```/g, m => `<pre>${m.slice(3, -3)}</pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function showToast(text) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ========== Connection health ==========
let lastHealthUpdate = null;
function updateConnectionHealth() {
  lastHealthUpdate = Date.now();
  const indicator = document.getElementById('connection-indicator');
  const dot = document.getElementById('connection-dot');
  const ts = document.getElementById('connection-timestamp');
  if (indicator) indicator.classList.remove('disconnected');
  if (dot) dot.classList.remove('disconnected');
  if (ts) ts.textContent = 'just now';
}

function refreshConnectionDisplay() {
  const dot = document.getElementById('connection-dot');
  const ts = document.getElementById('connection-timestamp');
  if (!dot || !ts) return;

  if (!lastHealthUpdate) {
    dot.classList.add('disconnected');
    ts.textContent = '--';
    return;
  }

  const diff = Date.now() - lastHealthUpdate;
  const secs = Math.floor(diff / 1000);

  const indicator = document.getElementById('connection-indicator');
  // Mark disconnected if no update in 60s
  if (secs > 60) {
    dot.classList.add('disconnected');
    if (indicator) indicator.classList.add('disconnected');
  } else {
    dot.classList.remove('disconnected');
    if (indicator) indicator.classList.remove('disconnected');
  }

  if (secs < 5) ts.textContent = 'just now';
  else if (secs < 60) ts.textContent = `${secs}s ago`;
  else if (secs < 3600) ts.textContent = `${Math.floor(secs / 60)}m ago`;
  else ts.textContent = `${Math.floor(secs / 3600)}h ago`;
}

// Update the display every 5 seconds, but skip when tab is hidden
setInterval(() => {
  if (!document.hidden) refreshConnectionDisplay();
}, 5000);

// ========== Init ==========
loadSettings();
loadSessions();
