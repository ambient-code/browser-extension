function kindIcon(kind) {
  switch (kind) {
    case 'input_needed': return '❓';
    case 'run_finished': return '✓';
    case 'error': return '⚠';
    default: return '•';
  }
}

function renderNotifications(notifications) {
  const list = document.getElementById('notification-list');
  const empty = document.getElementById('popup-empty');

  if (!notifications || notifications.length === 0) {
    list.style.display = 'none';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  list.style.display = '';

  while (list.firstChild) list.removeChild(list.firstChild);

  const sorted = notifications.slice().sort((a, b) => b.ts - a.ts);
  const top3 = sorted.slice(0, 3);

  top3.forEach(n => {
    const item = document.createElement('div');
    item.className = 'notification-item' + (n.read ? '' : ' unread');

    const iconDiv = document.createElement('div');
    iconDiv.className = 'notification-kind';
    iconDiv.textContent = kindIcon(n.kind);

    const content = document.createElement('div');
    content.className = 'notification-content';

    const title = document.createElement('div');
    title.className = 'notification-title';
    title.textContent = n.title;

    const body = document.createElement('div');
    body.className = 'notification-body text-muted';
    body.textContent = n.body;

    const time = document.createElement('div');
    time.className = 'notification-time text-muted';
    time.textContent = timeAgo(n.ts);

    content.appendChild(title);
    content.appendChild(body);
    content.appendChild(time);

    item.appendChild(iconDiv);
    item.appendChild(content);

    item.addEventListener('click', () => {
      try {
        chrome.windows.getCurrent(w => chrome.sidePanel.open({ windowId: w.id }));
      } catch (_) {}
      window.close();
    });

    list.appendChild(item);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'GET_NOTIFICATIONS' }, (response) => {
    renderNotifications(response?.notifications || []);
  });

  document.getElementById('mark-all-read').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'MARK_ALL_READ' }, () => {
      document.querySelectorAll('.notification-item').forEach(item => {
        item.classList.remove('unread');
      });
    });
  });

  document.getElementById('open-sidepanel').addEventListener('click', () => {
    try {
      chrome.windows.getCurrent(w => chrome.sidePanel.open({ windowId: w.id }));
    } catch (_) {}
    window.close();
  });
});
