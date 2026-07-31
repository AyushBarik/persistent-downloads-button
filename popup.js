const MAX_ITEMS = 50;

// Size caps for pre-encoding files when their row scrolls into view.
const PREFETCH_FILE_LIMIT = 20 * 1024 * 1024;
const PREFETCH_TOTAL_BUDGET = 200 * 1024 * 1024;
let prefetchedBytes = 0;

const rowObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    rowObserver.unobserve(entry.target);
    const item = entry.target._downloadItem;
    if (!item || !item.filename) continue;
    if (b64Cache.has(item.id)) continue;
    const size = item.fileSize > 0 ? item.fileSize : item.totalBytes;
    if (size > PREFETCH_FILE_LIMIT) continue;
    if (prefetchedBytes + size > PREFETCH_TOTAL_BUDGET) continue;
    prefetchedBytes += size;
    encodeFile(item).catch(() => {
      prefetchedBytes -= size;
    });
  }
});

let hasFileSchemeAccess = false;
let renderTimer = null;

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// Cache of base64 file payloads, keyed by download id. Holds promises so
// concurrent callers share a single read.
const b64Cache = new Map();

// Records the result of a file read and toggles the file-access notice.
function noteFileRead(ok) {
  hasFileSchemeAccess = ok;
  document.getElementById('file-access-notice').hidden = ok;
}

function encodeFile(item) {
  let promise = b64Cache.get(item.id);
  if (promise) return promise;
  promise = (async () => {
    let blob;
    try {
      const r = await fetch(toFileUrl(item.filename));
      blob = await r.blob();
    } catch (e) {
      noteFileRead(false);
      throw e;
    }
    noteFileRead(true);
    if (blob.size > MAX_UPLOAD_BYTES) throw new Error('too large');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',', 2)[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  })();
  // Drop failed reads from the cache so a later click can retry.
  promise.catch(() => b64Cache.delete(item.id));
  b64Cache.set(item.id, promise);
  return promise;
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
  // While the notice is showing, probe file access with a real read and
  // hide the notice once a read succeeds.
  setInterval(async () => {
    if (hasFileSchemeAccess) return;
    const items = await chrome.downloads.search({
      orderBy: ['-startTime'],
      limit: MAX_ITEMS,
    });
    const probe = items.find(
      (i) => i.state === 'complete' && i.exists !== false && i.filename
    );
    if (probe) {
      encodeFile(probe)
        .then(() => noteFileRead(true))
        .catch(() => {});
    }
  }, 1500);

  // Install the drop catcher on the active tab.
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab) {
      chrome.runtime.sendMessage({ type: 'fdbArmTab', tabId: tab.id }).catch(() => {});
    }
  });

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
  rowObserver.disconnect();
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
  chrome.downloads.getFileIcon(item.id, { size: 32 }, (url) => {
    if (!chrome.runtime.lastError && url) icon.src = url;
  });
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
    row._downloadItem = item;
    rowObserver.observe(row);
    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'show-btn upload-btn';
    uploadBtn.title = 'Upload to current page';
    uploadBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M12 3l5 5h-3v6h-4V8H7l5-5zM5 19h14v2H5v-2z"/></svg>';
    uploadBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      uploadToPage(item, name, sub);
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

    // Carry the download id for the in-page drop catcher.
    ev.dataTransfer.setData('application/x-fdb-download-id', String(item.id));
  });

  row.addEventListener('dragend', () => row.classList.remove('dragging'));
}

async function uploadToPage(item, name, statusEl) {
  const restore = statusEl.textContent;
  const fail = (msg) => {
    statusEl.textContent = msg;
    setTimeout(() => (statusEl.textContent = restore), 4000);
  };

  statusEl.textContent = 'Uploading…';
  let base64;
  try {
    base64 = await encodeFile(item);
  } catch (e) {
    fail(
      e && e.message === 'too large'
        ? 'File too large (100 MB max)'
        : 'Could not read file from disk'
    );
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    fail('No active tab');
    return;
  }

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: pageReceiveFile,
      args: [base64, name, guessMime(name)],
    });
  } catch (e) {
    fail("Can't upload on this page");
    console.error('executeScript failed:', e);
    return;
  }

  const outcome = results && results[0] && results[0].result;
  if (outcome && outcome.ok) {
    statusEl.textContent = `Sent to page ✓ (${outcome.method})`;
    setTimeout(() => window.close(), 250);
  } else {
    console.error('page injection outcome:', outcome);
    fail(
      outcome && outcome.error
        ? `Error: ${outcome.error.slice(0, 60)}`
        : 'Page did not accept the file'
    );
  }
}

// Injected into the target page (MAIN world). Rebuilds the File and hands it
// to a file input if one exists, otherwise dispatches a drop event.
// Self-contained: has no access to outer-scope variables.
function pageReceiveFile(base64, name, mime) {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], name, { type: mime });

    const dt = new DataTransfer();
    dt.items.add(file);

    const inputs = Array.from(
      document.querySelectorAll('input[type="file"]')
    ).filter((el) => !el.disabled);
    const input = inputs.find((el) => el.offsetParent) || inputs[0];
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return { ok: true, method: 'input' };
    }

    const x = Math.floor(window.innerWidth / 2);
    const y = Math.floor(window.innerHeight / 2);
    const target =
      document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : document.elementFromPoint(x, y) || document.body;

    let accepted = false;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      const ev = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        dataTransfer: dt,
      });
      target.dispatchEvent(ev);
      if (type === 'drop') accepted = ev.defaultPrevented;
    }
    if (accepted) return { ok: true, method: 'drop' };

    return { ok: false, error: 'no file input found and drop not handled' };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
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
