// utils.js — Shared utilities used by sidepanel.js, popup.js, and background.js
// Loaded via <script> in HTML pages, or importScripts() in service worker.

/**
 * Escape HTML entities for safe insertion into the DOM.
 */
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/**
 * Human-friendly relative timestamp (e.g. "3m ago", "2h ago").
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * Read ACP connection config from chrome.storage.local.
 */
async function getConfig() {
  const data = await chrome.storage.local.get(['baseUrl', 'apiKey', 'projectName']);
  return {
    baseUrl: (data.baseUrl || 'http://localhost:8080').replace(/\/+$/, ''),
    apiKey: data.apiKey || '',
    projectName: data.projectName || 'default',
  };
}

/**
 * Loading dots SVG markup (matches platform frontend animation).
 * @param {'large'|'small'} size - 'large' (56×16, chat) or 'small' (28×8, inline)
 */
function loadingDotsSVG(size) {
  if (size === 'small') {
    return `<svg width="28" height="8" viewBox="0 0 28 8"><circle class="loading-dot loading-dot-1" cx="4" cy="4" r="3" fill="#0066B1"/><circle class="loading-dot loading-dot-2" cx="11" cy="4" r="3" fill="#522DAE"/><circle class="loading-dot loading-dot-3" cx="18" cy="4" r="3" fill="#F40000"/><circle class="loading-dot loading-dot-4" cx="25" cy="4" r="3" fill="currentColor" stroke="#9CA3AF" stroke-width="0.5"/></svg>`;
  }
  return `<svg width="56" height="16" viewBox="0 0 56 16"><circle class="loading-dot loading-dot-1" cx="8" cy="8" r="6" fill="#0066B1"/><circle class="loading-dot loading-dot-2" cx="22" cy="8" r="6" fill="#522DAE"/><circle class="loading-dot loading-dot-3" cx="36" cy="8" r="6" fill="#F40000"/><circle class="loading-dot loading-dot-4" cx="50" cy="8" r="6" fill="#FFFFFF" stroke="#9CA3AF" stroke-width="1"/></svg>`;
}
