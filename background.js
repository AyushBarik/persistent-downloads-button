// Background service worker: installs the in-page drop catcher and delivers a
// downloaded file into a page when a row is dropped on it.

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'fdbArmTab') {
    chrome.scripting
      .executeScript({
        target: { tabId: msg.tabId },
        func: installDropCatcher,
      })
      .catch(() => {}); // page where scripts can't be injected
    return;
  }

  if (msg.type === 'fdbDrop' && sender.tab) {
    deliverFile(msg.downloadId, sender.tab.id, msg.x, msg.y)
      .then(sendResponse)
      .catch((e) => {
        console.error('drag-drop delivery failed:', e);
        sendResponse({ ok: false, error: String(e) });
      });
    return true; // async response
  }
});

// Injected into the page (isolated world). Listens for a drop carrying the
// extension's drag type and forwards the download id to the worker. Only
// genuine user drags (isTrusted) are accepted; all other drags are ignored.
function installDropCatcher() {
  if (window.__fdbCatcherInstalled) return;
  window.__fdbCatcherInstalled = true;
  const TYPE = 'application/x-fdb-download-id';
  const isOurs = (e) =>
    e.isTrusted &&
    e.dataTransfer &&
    Array.from(e.dataTransfer.types || []).includes(TYPE);

  window.addEventListener(
    'dragover',
    (e) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    true
  );

  window.addEventListener(
    'drop',
    (e) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const downloadId = Number(e.dataTransfer.getData(TYPE));
      if (downloadId) {
        chrome.runtime.sendMessage({
          type: 'fdbDrop',
          downloadId,
          x: e.clientX,
          y: e.clientY,
        });
      }
    },
    true
  );
}

async function deliverFile(downloadId, tabId, x, y) {
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item || !item.filename) return { ok: false, error: 'download not found' };

  const name = item.filename.split(/[\\/]/).pop();
  const ext = name.split('.').pop().toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';

  const blob = await fetch(toFileUrl(item.filename)).then((r) => r.blob());
  if (blob.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'too large' };
  const base64 = await blobToBase64(blob);

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: pageReceiveFile,
    args: [base64, name, mime, x, y],
  });
  return (results && results[0] && results[0].result) || { ok: false };
}

// Base64-encode a blob in chunks (FileReader is unavailable in workers).
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function toFileUrl(path) {
  const normalized = path.replace(/\\/g, '/');
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///';
  return prefix + normalized.split('/').map(encodeURIComponent).join('/');
}

// Injected into the target page (MAIN world). Rebuilds the File and hands it
// to a file input if one exists, otherwise dispatches a drop event at the
// drop position. Kept in sync with the copy in popup.js.
function pageReceiveFile(base64, name, mime, dropX, dropY) {
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

    const x = dropX != null ? dropX : Math.floor(window.innerWidth / 2);
    const y = dropY != null ? dropY : Math.floor(window.innerHeight / 2);
    const target =
      document.elementFromPoint(x, y) ||
      (document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : document.body);

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
