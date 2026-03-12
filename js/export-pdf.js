// ─────────────────────────────────────────────
// export-pdf.js — PDF export (experimental)
// ─────────────────────────────────────────────

const exportPdfBtn    = document.getElementById('exportPdfBtn');
const pdfModal        = document.getElementById('pdfModal');
const pdfBackdrop     = document.querySelector('.pdf-backdrop');
const pdfStatus       = document.getElementById('pdfStatus');
const pdfProgressFill = document.getElementById('pdfProgressFill');
const pdfPreview      = document.getElementById('pdfPreview');
const pdfPreviewFrame = document.getElementById('pdfPreviewFrame');
const pdfCancelBtn    = document.getElementById('pdfCancelBtn');
const pdfDownloadBtn  = document.getElementById('pdfDownloadBtn');
const pdfCloseBtn     = document.getElementById('pdfCloseBtn');

let __pdfState = { running: false, cancel: false, blobUrl: null, fileName: null };
window.__pdfState = __pdfState; // expose for beforeunload in chat.js

// ── event listeners ──
exportPdfBtn?.addEventListener('click', (e) => { e.preventDefault(); startPdfExport(); });
pdfCancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (__pdfState.running) {
        __pdfState.cancel = true;
        try { pdfCancelBtn.disabled = true; } catch (e) {}
        pdfSetProgress(0, 'Cancelling...');
    }
});
pdfDownloadBtn?.addEventListener('click', (e) => { e.preventDefault(); downloadPdf(); });
pdfCloseBtn?.addEventListener('click',   (e) => { e.preventDefault(); closePdfModal(); });
pdfBackdrop?.addEventListener('click', closePdfModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pdfModal?.getAttribute('aria-hidden') === 'false') closePdfModal();
});

// ── modal helpers ──

function pdfSetProgress(percent, text) {
    try {
        if (typeof percent === 'number' && pdfProgressFill) pdfProgressFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
        if (pdfStatus && text) pdfStatus.innerText = text;
    } catch (e) {}
}

function pdfResetUi() {
    __pdfState.cancel = false;
    __pdfState.running = false;
    if (pdfDownloadBtn)  pdfDownloadBtn.disabled = true;
    if (pdfCancelBtn)    pdfCancelBtn.disabled   = false;
    if (pdfCloseBtn)     pdfCloseBtn.disabled    = false;
    if (pdfPreview)      pdfPreview.setAttribute('aria-hidden', 'true');
    if (pdfPreviewFrame) pdfPreviewFrame.removeAttribute('src');
    try { if (__pdfState.blobUrl) URL.revokeObjectURL(__pdfState.blobUrl); } catch (e) {}
    __pdfState.blobUrl = null;
    __pdfState.fileName = null;
    pdfSetProgress(0, 'Preparing...');
}

function pdfSetBusyState(isBusy, statusText) {
    try {
        if (pdfCancelBtn) pdfCancelBtn.disabled = !isBusy;
        if (pdfCloseBtn)  pdfCloseBtn.disabled  = false;
        if (pdfDownloadBtn) pdfDownloadBtn.disabled = true;
        if (statusText) pdfSetProgress(undefined, statusText);
    } catch (e) {}
}

function pdfSetReadyState() {
    try {
        if (pdfCancelBtn)  pdfCancelBtn.disabled  = true;
        if (pdfCloseBtn)   pdfCloseBtn.disabled   = false;
        if (pdfDownloadBtn) pdfDownloadBtn.disabled = false;
    } catch (e) {}
}

function openPdfModal() {
    if (pdfModal) pdfModal.setAttribute('aria-hidden', 'false');
}

function closePdfModal() {
    if (!pdfModal) return;
    if (__pdfState.running) { __pdfState.cancel = true; pdfSetProgress(0, 'Cancelling...'); return; }
    pdfModal.setAttribute('aria-hidden', 'true');
    pdfResetUi();
}

// ── PDF build ──

async function buildChatPdf(data, selectedPerspective) {
    const JsPdfCtor = window.jspdf?.jsPDF;
    if (!JsPdfCtor) throw new Error('jsPDF not loaded');
    const h2c = window.html2canvas;
    if (!h2c) throw new Error('html2canvas not loaded');

    const threadName = data.threadName || data.title || data.threadPath || 'Untitled';
    const messages   = Array.isArray(data.messages) ? data.messages : [];

    const chatEl = document.getElementById('chat');
    const chatContainerEl = document.querySelector('.chat-container');
    const chatWidthPx = Math.max(680, Math.min(980, chatEl?.clientWidth || 860));
    const pageWidthPx  = chatWidthPx;
    const pageHeightPx = Math.round(pageWidthPx * 297 / 210);
    const pagePaddingPx = 10;

    const bg = (() => {
        try { return getComputedStyle(chatContainerEl).backgroundColor || '#ffffff'; } catch (e) { return '#ffffff'; }
    })();

    const offscreen = document.createElement('div');
    offscreen.style.cssText = `position:fixed;left:-10000px;top:0;width:${pageWidthPx}px;z-index:-1;background:${bg};color:inherit`;

    const content = document.createElement('div');
    content.style.cssText = `box-sizing:border-box;width:100%;padding:${pagePaddingPx}px;background:${bg}`;

    const header = document.createElement('div');
    header.style.cssText = 'box-sizing:border-box;width:100%;font-size:14px;margin-bottom:8px;';
    try { const m = getComputedStyle(document.documentElement).getPropertyValue('--muted'); if (m) header.style.color = m.trim(); } catch (e) {}
    header.textContent = `${threadName} — Exported ${new Date().toLocaleString()}`;
    content.appendChild(header);

    const messagesHost = document.createElement('div');
    messagesHost.style.cssText = 'box-sizing:border-box;width:100%';
    content.appendChild(messagesHost);
    offscreen.appendChild(content);
    document.body.appendChild(offscreen);

    const showMyName    = !!document.getElementById('showMyName')?.checked;
    const showTheirName = !!document.getElementById('showTheirName')?.checked;
    const showTime      = !!document.getElementById('showTime')?.checked;
    const showReacts    = !!document.getElementById('showReacts')?.checked;

    pdfSetProgress(0, 'Preparing DOM...');
    await yieldToUi();

    const BUILD_BATCH = 200;
    for (let i = 0; i < messages.length; i++) {
        if (__pdfState.cancel) { offscreen.remove(); throw new Error('cancelled'); }

        const msg = messages[i];
        const sender = msg.senderName || msg.sender_name || 'Unknown';
        const fromMe = sender === selectedPerspective;
        const div = document.createElement('div');
        div.classList.add('message', fromMe ? 'from-me' : 'from-them');
        div.innerHTML = createMessageHTML(msg, '');
        messagesHost.appendChild(div);

        try {
            if (!showTime)                        div.querySelectorAll('.timestamp').forEach(el => (el.style.display = 'none'));
            if (!showReacts)                      div.querySelectorAll('.reaction').forEach(el => (el.style.display = 'none'));
            if (fromMe  && !showMyName)           div.querySelectorAll('.sender-name').forEach(el => (el.style.display = 'none'));
            if (!fromMe && !showTheirName)        div.querySelectorAll('.sender-name').forEach(el => (el.style.display = 'none'));
        } catch (e) {}

        if ((i + 1) % BUILD_BATCH === 0) {
            pdfSetProgress(Math.round(((i + 1) / messages.length) * 30), `Preparing DOM ${i + 1}/${messages.length}...`);
            await yieldToUi();
        }
    }

    await yieldToUi();

    // Replace audio/video with capture-friendly placeholders (html2canvas can't render media)
    try {
        messagesHost.querySelectorAll('audio').forEach(a => {
            const ph = document.createElement('div');
            ph.className = 'placeholder';
            ph.textContent = '[Audio]';
            a.replaceWith(ph);
        });
        messagesHost.querySelectorAll('video').forEach(v => {
            const poster = v.getAttribute('poster');
            if (poster) {
                const img = document.createElement('img');
                img.className = 'preview'; img.src = poster; img.alt = 'Video thumbnail';
                v.replaceWith(img);
            } else {
                const ph = document.createElement('div'); ph.className = 'placeholder'; ph.textContent = '[Video]';
                v.replaceWith(ph);
            }
        });
    } catch (e) {}

    // Wait briefly for images to load
    try {
        const waits = Array.from(messagesHost.querySelectorAll('img')).map(img => new Promise(resolve => {
            if (img.complete) return resolve();
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
            setTimeout(resolve, 2500);
        }));
        await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 2600))]);
    } catch (e) {}

    await yieldToUi();

    const scrollHeight = Math.ceil(content.scrollHeight);
    const messageEls   = Array.from(messagesHost.querySelectorAll('.message'));
    const breaks = [0];
    let startY = 0;

    for (let guard = 0; guard < 500 && startY < scrollHeight - 2; guard++) {
        const limit = startY + pageHeightPx;
        let best = null;
        for (const el of messageEls) {
            const top    = (messagesHost.offsetTop || 0) + el.offsetTop;
            const bottom = top + el.offsetHeight;
            if (bottom <= limit && top >= startY) best = bottom;
            if (top > limit) break;
        }
        if (best === null || best <= startY + 60) best = Math.min(limit, scrollHeight);
        if (best >= scrollHeight) { breaks.push(scrollHeight); break; }
        breaks.push(Math.min(best, scrollHeight));
        startY = breaks[breaks.length - 1];
    }

    const pageCount = Math.max(1, breaks.length - 1);
    const doc = new JsPdfCtor({ unit: 'pt', format: 'a4' });
    const pageWidthPt  = doc.internal.pageSize.getWidth();
    const pageHeightPt = doc.internal.pageSize.getHeight();
    const marginPt     = 10;
    const targetWidthPt  = pageWidthPt  - marginPt * 2;
    const targetHeightPt = pageHeightPt - marginPt * 2;

    for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
        if (__pdfState.cancel) { offscreen.remove(); throw new Error('cancelled'); }

        const slice = document.createElement('div');
        slice.style.cssText = `width:${pageWidthPx}px;height:${pageHeightPx}px;overflow:hidden;background:${bg}`;
        const inner = content.cloneNode(true);
        inner.style.transform = `translateY(-${breaks[pageIdx]}px)`;
        inner.style.transformOrigin = 'top left';
        slice.appendChild(inner);
        offscreen.appendChild(slice);

        const canvas = await h2c(slice, {
            backgroundColor: bg,
            scale: Math.min(2, window.devicePixelRatio || 1),
            useCORS: true,
            logging: false,
        });
        slice.remove();

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const imgH = Math.min(targetHeightPt, (canvas.height * targetWidthPt) / canvas.width);
        if (pageIdx > 0) doc.addPage();
        doc.addImage(imgData, 'JPEG', marginPt, marginPt, targetWidthPt, imgH, undefined, 'FAST');

        pdfSetProgress(30 + Math.round(((pageIdx + 1) / pageCount) * 70), `Rendering page ${pageIdx + 1}/${pageCount}...`);
        await yieldToUi();
    }

    offscreen.remove();
    pdfSetProgress(100, 'Finalizing...');
    await yieldToUi();

    const blob = doc.output('blob');
    return { blob, fileName: sanitizeFileName(threadName) + '.pdf' };
}

// ── export entry point ──

async function startPdfExport() {
    if (__pdfState.running) return;
    const data = window.currentChatData;
    if (!data?.messages?.length) return;

    const total = data.messages.length;
    if (total > 12000) {
        alert('This conversation is too large for PDF export. Please narrow down the data and try again.');
        return;
    }
    if (total > 4000 && !confirm(`This export includes ${total} messages and may take a long time. Continue?`)) return;

    openPdfModal();
    pdfResetUi();
    __pdfState.running = true;

    try {
        pdfSetBusyState(true, 'Preparing...');
        pdfSetProgress(0, 'Preparing...');
        await yieldToUi();

        const { blob, fileName } = await buildChatPdf(data, getSelectedPerspective());
        if (__pdfState.cancel) throw new Error('cancelled');

        const url = URL.createObjectURL(blob);
        __pdfState.blobUrl = url;
        __pdfState.fileName = fileName;
        if (pdfPreviewFrame) pdfPreviewFrame.src = url;
        if (pdfPreview) pdfPreview.setAttribute('aria-hidden', 'false');
        pdfSetReadyState();
        pdfSetProgress(100, 'Ready. Preview below.');
    } catch (e) {
        pdfSetProgress(0, String(e?.message) === 'cancelled' ? 'Cancelled.' : 'Failed to export PDF.');
    } finally {
        __pdfState.running = false;
        __pdfState.cancel  = false;
    }
}

function downloadPdf() {
    if (!__pdfState.blobUrl || !__pdfState.fileName) return;
    const a = document.createElement('a');
    a.href = __pdfState.blobUrl;
    a.download = __pdfState.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
}
