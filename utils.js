function escHtml(str) {
  if (typeof document === 'undefined') {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function getConfig() {
  const data = await chrome.storage.local.get(['baseUrl', 'projectName']);
  return {
    baseUrl: (data.baseUrl || '').replace(/\/+$/, ''),
    projectName: data.projectName || ''
  };
}

function loadingDotsSVG(size) {
  if (size === 'large') {
    return `<svg width="56" height="16" viewBox="0 0 56 16" xmlns="http://www.w3.org/2000/svg">
      <circle class="loading-dot loading-dot-1" cx="6" cy="8" r="6" fill="#0066B1"/>
      <circle class="loading-dot loading-dot-2" cx="22" cy="8" r="6" fill="#522DAE"/>
      <circle class="loading-dot loading-dot-3" cx="38" cy="8" r="6" fill="#F40000"/>
      <circle class="loading-dot loading-dot-4" cx="54" cy="8" r="6" fill="currentColor" stroke="#9CA3AF"/>
    </svg>`;
  }
  return `<svg width="28" height="8" viewBox="0 0 28 8" xmlns="http://www.w3.org/2000/svg">
    <circle class="loading-dot loading-dot-1" cx="3" cy="4" r="3" fill="#0066B1"/>
    <circle class="loading-dot loading-dot-2" cx="11" cy="4" r="3" fill="#522DAE"/>
    <circle class="loading-dot loading-dot-3" cx="19" cy="4" r="3" fill="#F40000"/>
    <circle class="loading-dot loading-dot-4" cx="27" cy="4" r="3" fill="currentColor" stroke="#9CA3AF"/>
  </svg>`;
}

function showToast(message, type) {
  type = type || 'info';
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
