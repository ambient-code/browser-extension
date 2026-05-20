/* global oauthGetToken, oauthLogout, getConfig, chrome */

const API_BASE = '/api/ambient/v1';
const DEFAULT_TIMEOUT = 30000;

async function apiRequest(method, path, options = {}) {
  const { body, params, stream, timeout = DEFAULT_TIMEOUT } = options;
  const config = await getConfig();
  if (!config.baseUrl) throw new Error('Not configured');

  let url = `${config.baseUrl}${API_BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null) qs.set(k, v);
    }
    const str = qs.toString();
    if (str) url += `?${str}`;
  }

  let token = await oauthGetToken();
  if (!token) throw new Error('Not authenticated');

  const buildHeaders = (tkn) => {
    const h = {
      'Authorization': `Bearer ${tkn}`,
      'X-Ambient-Project': config.projectName || '',
      'User-Agent': 'acp-browser-extension/0.2.0',
      'Accept': stream ? 'text/event-stream' : 'application/json',
    };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    return h;
  };

  const buildFetchOpts = (tkn, signal) => {
    const opts = { method, headers: buildHeaders(tkn), signal };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return opts;
  };

  const doFetch = async (tkn) => {
    const controller = new AbortController();
    let timer;
    if (!stream && timeout > 0) {
      timer = setTimeout(() => controller.abort(), timeout);
    }
    try {
      return await fetch(url, buildFetchOpts(tkn, controller.signal));
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  let response = await doFetch(token);

  if (response.status === 401) {
    const refreshed = await oauthGetToken();
    if (refreshed && refreshed !== token) {
      response = await doFetch(refreshed);
    }
    if (response.status === 401) {
      try { chrome.runtime.sendMessage({ type: 'AUTH_EXPIRED' }); } catch (_) {}
      throw new Error('Authentication expired');
    }
  }

  if (stream && response.ok) return response;

  if (response.status === 204) return null;

  let json;
  try {
    json = await response.json();
  } catch (_) {
    json = null;
  }

  if (!response.ok) {
    const err = new Error(json?.reason || response.statusText);
    err.status = response.status;
    err.code = json?.code;
    err.reason = json?.reason;
    throw err;
  }

  return json;
}

function parseSSEStream(response, onEvent, onError, signal) {
  const controller = new AbortController();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines = [];

  if (signal) {
    signal.addEventListener('abort', () => {
      controller.abort();
      reader.cancel();
    });
  }

  (async () => {
    try {
      while (true) {
        if (controller.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            dataLines.push(line.slice(6));
          } else if (line === '' && dataLines.length > 0) {
            const raw = dataLines.join('\n');
            dataLines = [];
            try {
              onEvent(JSON.parse(raw));
            } catch (e) {
              if (onError) onError(e);
            }
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError' && onError) onError(e);
    }
  })();

  return controller;
}

const api = {
  sessions: {
    list: (params) => apiRequest('GET', '/sessions', { params }),
    get: (id) => apiRequest('GET', `/sessions/${id}`),
    create: (body) => apiRequest('POST', '/sessions', { body }),
    start: (id) => apiRequest('POST', `/sessions/${id}/start`),
    stop: (id) => apiRequest('POST', `/sessions/${id}/stop`),
    delete: (id) => apiRequest('DELETE', `/sessions/${id}`),
    listMessages: (id, afterSeq) =>
      apiRequest('GET', `/sessions/${id}/messages`, { params: { after_seq: afterSeq || 0 }, timeout: 60000 }),
    sendMessage: (id, payload) =>
      apiRequest('POST', `/sessions/${id}/messages`, { body: { event_type: 'user', payload }, timeout: 60000 }),
    streamMessages: (id, afterSeq) =>
      apiRequest('GET', `/sessions/${id}/messages`, { params: { after_seq: afterSeq || 0 }, stream: true }),
    streamEvents: (id) =>
      apiRequest('GET', `/sessions/${id}/events`, { stream: true }),
  },

  projects: {
    list: (params) => apiRequest('GET', '/projects', { params }),
    get: (id) => apiRequest('GET', `/projects/${id}`),
    create: (body) => apiRequest('POST', '/projects', { body }),
    update: (id, body) => apiRequest('PATCH', `/projects/${id}`, { body }),
    delete: (id) => apiRequest('DELETE', `/projects/${id}`),
  },

  agents: {},
  credentials: {},
  scheduledSessions: {},
};
