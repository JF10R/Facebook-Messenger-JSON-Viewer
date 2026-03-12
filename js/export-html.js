// ─────────────────────────────────────────────
// export-html.js — standalone HTML archive export
// ─────────────────────────────────────────────

const htmlModal      = document.getElementById('htmlModal');
const htmlBackdrop   = document.querySelector('.html-backdrop');
const htmlCancelBtn  = document.getElementById('htmlCancelBtn');
const htmlDownloadBtn = document.getElementById('htmlDownloadBtn');
const htmlCloseBtn   = document.getElementById('htmlCloseBtn');
const exportHtmlBtn  = document.getElementById('exportHtmlBtn');

const __htmlState = { running: false, cancel: false, blobUrl: null, fileName: null };

// Reusable canvas for image compression (avoids repeated canvas allocations)
const __compressCanvas = { el: null, ctx: null };

// ── event listeners ──
exportHtmlBtn?.addEventListener('click', (e) => { e.preventDefault(); startHtmlExport(); });
htmlCancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (__htmlState.running) { __htmlState.cancel = true; htmlCancelBtn.disabled = true; htmlSetProgress(0, 'Cancelling...'); }
});
htmlDownloadBtn?.addEventListener('click', (e) => { e.preventDefault(); downloadHtmlArchive(); });
htmlCloseBtn?.addEventListener('click',   (e) => { e.preventDefault(); closeHtmlModal(); });
htmlBackdrop?.addEventListener('click', closeHtmlModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && htmlModal?.getAttribute('aria-hidden') === 'false') closeHtmlModal();
});

// Slider label updates
document.getElementById('htmlJpegQuality')?.addEventListener('input', (e) => {
    const label = document.getElementById('htmlQualityLabel');
    if (label) label.textContent = e.target.value + '%';
});
document.getElementById('htmlMaxRes')?.addEventListener('input', (e) => {
    const label = document.getElementById('htmlResLabel');
    if (label) label.textContent = e.target.value + 'px';
});
document.getElementById('htmlCompressImages')?.addEventListener('change', (e) => {
    const settings = document.getElementById('htmlCompressionSettings');
    if (settings) settings.style.display = e.target.checked ? '' : 'none';
});
document.getElementById('htmlIncludeMedia')?.addEventListener('change', (e) => {
    const compressCb = document.getElementById('htmlCompressImages');
    const settings   = document.getElementById('htmlCompressionSettings');
    if (compressCb) compressCb.disabled = !e.target.checked;
    if (settings)   settings.style.display = (e.target.checked && compressCb?.checked) ? '' : 'none';
});

// ── modal helpers ──

function openHtmlModal() {
    if (htmlModal) htmlModal.setAttribute('aria-hidden', 'false');
}

function closeHtmlModal() {
    if (__htmlState.running) __htmlState.cancel = true;
    if (htmlModal) htmlModal.setAttribute('aria-hidden', 'true');
    if (__htmlState.blobUrl) { URL.revokeObjectURL(__htmlState.blobUrl); __htmlState.blobUrl = null; }
    __htmlState.running = false;
    __htmlState.cancel  = false;
    if (htmlDownloadBtn) htmlDownloadBtn.disabled = true;
}

function htmlSetProgress(pct, text) {
    const fill   = document.getElementById('htmlProgressFill');
    const status = document.getElementById('htmlStatus');
    if (fill)   fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (status) status.textContent = text || '';
}

function htmlSetSize(text) {
    const el = document.getElementById('htmlSizeEstimate');
    if (el) el.textContent = text || '';
}

// ── media conversion ──

async function blobUrlToDataUri(blobUrl, mType, compress, maxPx, quality) {
    const blob = await (await fetch(blobUrl)).blob();
    if (compress && mType === 'image' && blob.size > 0) {
        try {
            const dataUri = await compressImageBlob(blob, maxPx, quality);
            if (dataUri) return dataUri;
        } catch (e) { console.warn('Image compression failed, using raw base64:', e); }
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function compressImageBlob(blob, maxPx, quality) {
    const MAX = maxPx || 800;
    const Q   = quality || 0.65;
    return new Promise(resolve => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            let { width: w, height: h } = img;
            if (w > MAX || h > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
            if (!__compressCanvas.el) {
                __compressCanvas.el  = document.createElement('canvas');
                __compressCanvas.ctx = __compressCanvas.el.getContext('2d');
            }
            __compressCanvas.el.width  = w;
            __compressCanvas.el.height = h;
            __compressCanvas.ctx.clearRect(0, 0, w, h);
            __compressCanvas.ctx.drawImage(img, 0, 0, w, h);
            const dataUri = __compressCanvas.el.toDataURL('image/jpeg', Q);
            URL.revokeObjectURL(url);
            resolve(dataUri);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

// ── archive build ──

async function buildHtmlArchive(data, selectedPerspective) {
    const threadName    = data.threadName || data.title || data.threadPath || 'Untitled';
    const messages      = Array.isArray(data.messages) ? data.messages : [];
    const compressImages = !!document.getElementById('htmlCompressImages')?.checked;
    const includeMedia   = !!document.getElementById('htmlIncludeMedia')?.checked;
    const jpegQuality    = (parseInt(document.getElementById('htmlJpegQuality')?.value, 10) || 65) / 100;
    const maxResolution  = parseInt(document.getElementById('htmlMaxRes')?.value, 10) || 800;
    const showMyName     = !!document.getElementById('showMyName')?.checked;
    const showTheirName  = !!document.getElementById('showTheirName')?.checked;
    const showTime       = !!document.getElementById('showTime')?.checked;
    const showReacts     = !!document.getElementById('showReacts')?.checked;

    // Phase 1 — convert media to data URIs
    const mediaMap = new Map(); // fileName → dataUri
    if (includeMedia) {
        const refs = new Set();
        for (const msg of messages) {
            for (const item of getMessageMedia(msg)) {
                if (item?.uri) refs.add(item.uri.split(/[\\\/]/).pop().toLowerCase());
            }
        }

        const refArr = [...refs];
        const mediaLookup = getMediaLookupMap();
        const BATCH = 15;
        for (let i = 0; i < refArr.length; i += BATCH) {
            if (__htmlState.cancel) throw new Error('cancelled');
            const results = await Promise.all(refArr.slice(i, Math.min(i + BATCH, refArr.length)).map(fileName => {
                const matchingFile = mediaLookup.get(fileName) || null;
                if (!matchingFile || !mediaFiles[matchingFile]) return Promise.resolve(null);
                const mType = mediaTypes[matchingFile] || getMediaType(fileName);
                return blobUrlToDataUri(mediaFiles[matchingFile], mType, compressImages, maxResolution, jpegQuality)
                    .then(dataUri => ({ fileName, dataUri }))
                    .catch(e => { console.warn('Media conversion failed:', fileName, e); return null; });
            }));
            for (const r of results) { if (r?.dataUri) mediaMap.set(r.fileName, r.dataUri); }
            htmlSetProgress((Math.min(i + BATCH, refArr.length) / refArr.length) * 60, `Converting media ${Math.min(i + BATCH, refArr.length)}/${refArr.length}...`);
            await yieldToUi();
        }
    }

    if (__htmlState.cancel) throw new Error('cancelled');
    htmlSetProgress(65, 'Building HTML...');
    await yieldToUi();

    // Phase 2 — build message HTML
    const msgParts = [];
    for (let i = 0; i < messages.length; i++) {
        const msg    = messages[i];
        const sender = msg.senderName || msg.sender_name || 'Unknown';
        const fromMe = sender === selectedPerspective;
        const text   = escapeHtml(String(msg.text || msg.content || '')).replace(/\n/g, '<br>');
        const ts     = msg.timestamp || msg.timestamp_ms || 0;

        const mediaParts = [];
        for (const media of getMessageMedia(msg)) {
            if (!media?.uri) continue;
            const fileName = media.uri.split(/[\\\/]/).pop().toLowerCase();
            const dataUri  = mediaMap.get(fileName);
            const mType    = fileName.split('.').pop().toLowerCase() === 'mp4' ? 'video' : getMediaType(fileName);
            if (!dataUri) { mediaParts.push(`<span class="media-missing">[Media: ${escapeHtml(fileName)}]</span>`); continue; }
            if (mType === 'image')  mediaParts.push(`<img src="${dataUri}" alt="Image">`);
            else if (mType === 'video') mediaParts.push(`<video controls preload="metadata"><source src="${dataUri}" type="video/mp4"></video>`);
            else if (mType === 'audio') mediaParts.push(`<audio controls preload="metadata"><source src="${dataUri}" type="audio/mpeg"></audio>`);
        }

        const senderHtml = (fromMe ? showMyName : showTheirName)
            ? `<div class="sender-name">${escapeHtml(sender)}</div>` : '';
        const timeHtml    = showTime    ? `<div class="timestamp" style="display:block">${new Date(ts).toLocaleString()}</div>` : '';
        const reactHtml   = (showReacts && msg.reactions?.length)
            ? `<div class="reaction">${msg.reactions.map(r => `${escapeHtml(r.actor)}: ${escapeHtml(r.reaction)}`).join(', ')}</div>` : '';

        msgParts.push(`<div class="message ${fromMe ? 'from-me' : 'from-them'}">${senderHtml}<div class="message-content">${text}${mediaParts.join('')}${reactHtml}${timeHtml}</div></div>`);

        if (i % 150 === 0 && i > 0) {
            if (__htmlState.cancel) throw new Error('cancelled');
            htmlSetProgress(65 + (i / messages.length) * 25, `Rendering message ${i}/${messages.length}...`);
            await yieldToUi();
        }
    }

    if (__htmlState.cancel) throw new Error('cancelled');
    htmlSetProgress(92, 'Assembling archive...');
    await yieldToUi();

    return buildStandaloneHtml(threadName, msgParts.join('\n'), document.documentElement.classList.contains('dark'));
}

function buildStandaloneHtml(threadName, messagesHtml, isDark) {
    const safeTitle  = escapeHtml(threadName);
    const exportDate = new Date().toLocaleString();
    return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safeTitle} \u2014 Messenger Export</title>
<style>
:root{--bg:#fff;--panel-bg:#f6f8fb;--text:#111213;--muted:#6b6f76;--accent:#0084ff;--me-bg:#0084ff;--me-text:#fff;--them-bg:#e9eef8;--border:#e6e9ee}
.dark{--bg:#0b1116;--panel-bg:#0f161b;--text:#e6eef8;--muted:#9aa4b2;--accent:#3ea6ff;--me-bg:#1667d6;--me-text:#f7fbff;--them-bg:#0f2a3a;--border:#1b2330}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:var(--bg);color:var(--text)}
.archive-header{position:sticky;top:0;z-index:10;background:var(--panel-bg);border-bottom:1px solid var(--border);padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
.archive-header h1{font-size:16px;margin:0}
.archive-meta{font-size:12px;color:var(--muted)}
.theme-toggle{background:var(--them-bg);border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px}
.chat{max-width:800px;margin:0 auto;padding:16px}
.message{margin:4px 8px;padding:10px 15px;border-radius:15px;max-width:65%;width:fit-content;word-break:break-word}
.from-me{background:var(--me-bg);color:var(--me-text);margin-left:auto}
.from-them{background:var(--them-bg);color:var(--text);margin-right:auto}
.sender-name{font-weight:bold;margin-bottom:4px;font-size:13px}
.from-me .sender-name{color:var(--me-text)}
.message-content{line-height:1.4;font-size:14px}
.from-me .message-content{color:var(--me-text)}
.timestamp{font-size:11px;margin-top:4px;opacity:0.7}
.from-me .timestamp{color:rgba(255,255,255,0.8)}
.from-them .timestamp{color:var(--muted)}
.reaction{font-size:13px;margin-top:4px;text-align:right;opacity:0.8}
img,video{max-width:100%;border-radius:8px;margin:4px 0;display:block}
audio{margin:4px 0;max-width:100%}
.media-missing{display:inline-block;padding:4px 8px;background:var(--border);border-radius:4px;font-size:12px;color:var(--muted);margin:2px 0}
*::-webkit-scrollbar{width:10px}
*::-webkit-scrollbar-thumb{background:var(--muted);border-radius:8px;border:2px solid transparent;background-clip:padding-box}
</style>
</head>
<body>
<div class="archive-header">
<div><h1>${escapeHtml(threadName)}</h1><div class="archive-meta">Exported ${escapeHtml(exportDate)} &middot; Facebook Messenger JSON Viewer</div></div>
<button class="theme-toggle" onclick="document.documentElement.classList.toggle('dark');this.textContent=document.documentElement.classList.contains('dark')?'Light mode':'Dark mode'">${isDark ? 'Light mode' : 'Dark mode'}</button>
</div>
<div class="chat">
${messagesHtml}
</div>
</body>
</html>`;
}

// ── export entry point ──

async function startHtmlExport() {
    const data = window.currentChatData;
    if (!data?.messages?.length) { alert('No conversation loaded to export.'); return; }

    openHtmlModal();
    __htmlState.cancel  = false;
    __htmlState.running = true;
    if (__htmlState.blobUrl) { URL.revokeObjectURL(__htmlState.blobUrl); __htmlState.blobUrl = null; }
    if (htmlDownloadBtn) htmlDownloadBtn.disabled = true;
    if (htmlCancelBtn)   htmlCancelBtn.disabled   = false;
    htmlSetProgress(0, 'Starting...');
    htmlSetSize('');

    try {
        const html = await buildHtmlArchive(data, getSelectedPerspective());
        if (__htmlState.cancel) throw new Error('cancelled');

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const safeName = (data.threadName || data.title || data.threadPath || 'conversation')
            .replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 60) || 'conversation';

        __htmlState.blobUrl  = url;
        __htmlState.fileName = `${safeName}.html`;
        __htmlState.running  = false;

        htmlSetProgress(100, 'Ready to download');
        htmlSetSize(`File size: ${formatBytes(blob.size)}`);
        if (htmlDownloadBtn) htmlDownloadBtn.disabled = false;
        if (htmlCancelBtn)   htmlCancelBtn.disabled   = true;
    } catch (err) {
        __htmlState.running = false;
        htmlSetProgress(0, err.message === 'cancelled' ? 'Cancelled' : 'Error: ' + String(err.message || err));
        if (err.message !== 'cancelled') console.error('HTML export error:', err);
    }
}

function downloadHtmlArchive() {
    if (!__htmlState.blobUrl || !__htmlState.fileName) return;
    const a = document.createElement('a');
    a.href = __htmlState.blobUrl;
    a.download = __htmlState.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}
