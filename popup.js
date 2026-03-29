// popup.js — Shows 3 most recent notifications, respects theme

// Apply theme from storage (fallback for popup which may not share localStorage)
chrome.storage.local.get('theme', (data) => {
  const theme = data.theme || 'dark';
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
});

async function render() {
  const notifications = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_NOTIFICATIONS' }, resolve);
  });

  const list = document.getElementById('notif-list');
  const empty = document.getElementById('empty-notifs');
  const recent = (notifications || []).slice(0, 3);

  if (recent.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  list.innerHTML = recent.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-title">
        <span class="notif-icon ${n.kind}"></span>
        ${escHtml(n.title)}
      </div>
      <div class="notif-body">${escHtml(n.body)}</div>
      <div class="notif-time">${timeAgo(n.ts)}</div>
    </div>
  `).join('');
}

document.getElementById('mark-read-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'MARK_ALL_READ' });
  render();
});

document.getElementById('open-panel-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
  window.close();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'NOTIFICATION_ADDED') render();
});

// escHtml() and timeAgo() provided by utils.js

render();
