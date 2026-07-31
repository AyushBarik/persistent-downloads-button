const MAX_ITEMS = 50;

let hasFileSchemeAccess = false;
let renderTimer = null;
let probeTimer = null;

// File icons by download id; they never change, so fetch each one once.
const iconCache = new Map();

// Records the result of a file read and toggles the file-access notice.
// Polling runs exactly while the notice is up: a success stops it, and a
// later failure restarts it so the notice can clear itself again.
function noteFileRead(ok) {
  hasFileSchemeAccess = ok;
  document.getElementById('file-access-notice').hidden = ok;
  if (ok) {
    clearInterval(probeTimer);
    probeTimer = null;
  } else if (!probeTimer) {
    probeTimer = setInterval(probeFileAccess, 1500);
  }
}

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

init();

async function init() {
  hasFileSchemeAccess = await new Promise((resolve) => {
    try {
      chrome.extension.isAllowedFileSchemeAccess(resolve);
    } catch {
      resolve(false);
    }
  });

  const notice = document.getElementById('file-access-notice');
  notice.hidden = hasFileSchemeAccess;
  document.getElementById('open-settings').addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  });
  // The toggle can be flipped while the popup is open, and Chrome doesn't
  // notify us, so poll until a read works. noteFileRead stops the poll.
  if (!hasFileSchemeAccess) probeTimer = setInterval(probeFileAccess, 1500);
  // Even when the API reports access, verify with a real read — the API
  // misses revoked site access and not-yet-applied toggle flips.
  probeFileAccess();

  // Install the drop catcher on the active tab.
  armActiveTab();

  document.getElementById('refresh-btn').addEventListener('click', (ev) => {
    const btn = ev.currentTarget;
    btn.classList.add('spinning');
    setTimeout(() => btn.classList.remove('spinning'), 700);
    // Remove history entries whose file no longer exists on disk, then
    // re-render. Does not delete any files.
    chrome.downloads.erase({ exists: false }, () => render());
  });

  await render();

  chrome.downloads.onCreated.addListener(scheduleRender);
  chrome.downloads.onChanged.addListener(scheduleRender);
  chrome.downloads.onErased.addListener(scheduleRender);
}

// Prove file access with a real read: isAllowedFileSchemeAccess only
// reflects the file-URLs toggle, so it stays true when access is broken
// another way (site access revoked, or a toggle flip the browser hasn't
// applied yet). Several candidates are tried so one deleted file doesn't
// read as missing access.
async function probeFileAccess() {
  const items = await chrome.downloads.search({
    orderBy: ['-startTime'],
    limit: MAX_ITEMS,
  });
  const candidates = items
    .filter((i) => i.state === 'complete' && i.exists !== false && i.filename)
    .slice(0, 3);
  if (!candidates.length) return; // nothing on disk to prove it either way
  for (const c of candidates) {
    try {
      await fetch(toFileUrl(c.filename));
      noteFileRead(true);
      return;
    } catch {
      // try the next candidate
    }
  }
  noteFileRead(false);
}

// Ask the worker to install the drop catcher on the active tab. Called on
// popup open and again on every dragstart: re-arming is idempotent, and the
// page may have been reloaded (or still been loading) since the last arm.
function armActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab) {
      chrome.runtime.sendMessage({ type: 'fdbArmTab', tabId: tab.id }).catch(() => {});
    }
  });
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 150);
}

async function render() {
  const items = await chrome.downloads.search({
    orderBy: ['-startTime'],
    limit: MAX_ITEMS,
  });

  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  list.textContent = '';
  empty.hidden = items.length > 0;

  for (const item of items) {
    list.appendChild(buildRow(item));
  }
}

function buildRow(item) {
  const name = displayName(item);
  const complete = item.state === 'complete';
  const missing = complete && item.exists === false;

  const row = document.createElement('li');
  row.className = 'item' + (missing ? ' missing' : '');
  row.title = name;

  const icon = document.createElement('img');
  icon.className = 'file-icon';
  icon.alt = '';
  // Icons never change for a given download, and re-renders are frequent
  // while a download is in progress, so fetch each one only once.
  const cachedIcon = iconCache.get(item.id);
  if (cachedIcon) {
    icon.src = cachedIcon;
  } else {
    chrome.downloads.getFileIcon(item.id, { size: 32 }, (url) => {
      if (chrome.runtime.lastError || !url) return;
      iconCache.set(item.id, url);
      icon.src = url;
    });
  }
  row.appendChild(icon);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const nameEl = document.createElement('div');
  nameEl.className = 'name';
  nameEl.textContent = name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = subtitle(item);
  meta.append(nameEl, sub);
  row.appendChild(meta);

  if (complete && !missing) {
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'show-btn upload-btn';
    uploadBtn.title = 'Upload to current page';
    uploadBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M12 3l5 5h-3v6h-4V8H7l5-5zM5 19h14v2H5v-2z"/></svg>';
    uploadBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      uploadToPage(item, sub);
    });
    row.appendChild(uploadBtn);
  }

  const showBtn = document.createElement('button');
  showBtn.className = 'show-btn';
  showBtn.title = 'Show in folder';
  showBtn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
  showBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    chrome.downloads.show(item.id);
  });
  row.appendChild(showBtn);

  row.addEventListener('click', () => {
    if (complete && item.exists !== false) chrome.downloads.open(item.id);
  });

  // Only completed downloads are draggable.
  if (complete) {
    row.setAttribute('draggable', 'true');
    setupDrag(row, item, name);
  }

  return row;
}

function setupDrag(row, item, name) {
  row.addEventListener('dragstart', (ev) => {
    row.classList.add('dragging');
    armActiveTab();

    // Use a clone of the row with a transparent background as the drag image.
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    ev.dataTransfer.setDragImage(
      ghost,
      ev.clientX - rect.left,
      ev.clientY - rect.top
    );
    setTimeout(() => ghost.remove(), 0);

    const mime = guessMime(name);

    // DownloadURL format is "mime:filename:url"; strip colons from the name.
    const safeName = name.replaceAll(':', '_');

    // Prefer a file:// URL to the local file; fall back to the source URL.
    let url;
    if (hasFileSchemeAccess && item.exists !== false && item.filename) {
      url = toFileUrl(item.filename);
    } else {
      url = item.finalUrl || item.url;
    }

    ev.dataTransfer.effectAllowed = 'copy';
    ev.dataTransfer.setData('DownloadURL', `${mime}:${safeName}:${url}`);

    // Marker so the in-page catcher knows to intercept this drop; the file
    // itself is identified by telling the worker what we're dragging.
    ev.dataTransfer.setData('application/x-fdb-download-id', '1');
    chrome.runtime
      .sendMessage({ type: 'fdbDragStart', downloadId: item.id })
      .catch(() => {});
  });

  row.addEventListener('dragend', () => row.classList.remove('dragging'));
}

// Reads and injects happen in the background worker, which already does
// exactly this for drag-and-drop; going through it keeps one delivery path.
const UPLOAD_ERRORS = {
  'too large': 'File too large (100 MB max)',
  'could not read file from disk': 'Could not read file from disk',
};

async function uploadToPage(item, statusEl) {
  const restore = statusEl.textContent;
  const fail = (msg) => {
    statusEl.textContent = msg;
    setTimeout(() => (statusEl.textContent = restore), 4000);
  };

  statusEl.textContent = 'Uploading…';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    fail('No active tab');
    return;
  }

  const outcome = await chrome.runtime
    .sendMessage({ type: 'fdbUpload', downloadId: item.id, tabId: tab.id })
    .catch(() => null);

  if (outcome && outcome.ok) {
    statusEl.textContent = `Sent to page ✓ (${outcome.method})`;
    setTimeout(() => window.close(), 250);
    return;
  }
  const error = outcome && outcome.error;
  if (error === 'could not read file from disk') noteFileRead(false);
  fail(
    (error && UPLOAD_ERRORS[error]) ||
      (error ? `Error: ${error.slice(0, 60)}` : "Can't upload on this page")
  );
}

function displayName(item) {
  if (item.filename) {
    return item.filename.split(/[\\/]/).pop();
  }
  try {
    const path = new URL(item.finalUrl || item.url).pathname;
    return decodeURIComponent(path.split('/').pop()) || 'Download';
  } catch {
    return 'Download';
  }
}

function subtitle(item) {
  if (item.state === 'in_progress') {
    if (item.paused) return 'Paused';
    if (item.totalBytes > 0) {
      const pct = Math.round((item.bytesReceived / item.totalBytes) * 100);
      return `Downloading\u2026 ${pct}%`;
    }
    return 'Downloading\u2026';
  }
  if (item.state === 'interrupted') return 'Failed';

  const size = item.fileSize > 0 ? item.fileSize : item.totalBytes;
  const parts = [];
  if (size > 0) parts.push(formatBytes(size));
  parts.push(relativeTime(new Date(item.endTime || item.startTime)));
  if (item.exists === false) parts.push('Deleted');
  return parts.join(' \u00b7 ');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = -1;
  do {
    value /= 1024;
    i++;
  } while (value >= 1024 && i < units.length - 1);
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function relativeTime(date) {
  const now = new Date();
  const diffMs = now - date;
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date >= startOfToday) return `${Math.floor(diffMs / 3_600_000)}h ago`;

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (date >= startOfYesterday) return 'Yesterday';

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function guessMime(name) {
  const ext = name.split('.').pop().toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

function toFileUrl(path) {
  // Normalize Windows backslashes to forward slashes.
  const normalized = path.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + normalized.split('/').map(encodeURIComponent).join('/');
}
