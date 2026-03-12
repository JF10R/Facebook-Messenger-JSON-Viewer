// ─────────────────────────────────────────────
// gallery.js — media gallery modal + lightbox
// ─────────────────────────────────────────────

const mediaGalleryBtn  = document.getElementById('mediaGalleryBtn');
const mediaModal       = document.getElementById('mediaModal');
const mediaModalClose  = document.getElementById('mediaModalClose');
const mediaModalGrid   = document.getElementById('mediaModalGrid');
const mediaModalStats  = document.getElementById('mediaModalStats');
const mediaLightbox    = document.getElementById('mediaLightbox');
const mediaLbMain      = document.getElementById('mediaLbMain');
const mediaLbCaption   = document.getElementById('mediaLbCaption');

let __galleryItems = [];
let __lbIndex = 0;
const GALLERY_BATCH = 30;
let __galleryRenderedCount = 0;
let __gallerySentinel = null;
let __galleryObserver = null;

// ── event listeners ──
mediaGalleryBtn?.addEventListener('click', openMediaGallery);
mediaModalClose?.addEventListener('click', closeMediaModal);
document.querySelector('.media-modal-backdrop')?.addEventListener('click', closeMediaModal);
document.getElementById('mediaLbClose')?.addEventListener('click', closeLightbox);
document.querySelector('.media-lightbox-backdrop')?.addEventListener('click', closeLightbox);
document.getElementById('mediaLbPrev')?.addEventListener('click', () => moveLightbox(-1));
document.getElementById('mediaLbNext')?.addEventListener('click', () => moveLightbox(1));

document.addEventListener('keydown', (e) => {
    if (mediaLightbox?.getAttribute('aria-hidden') === 'false') {
        if (e.key === 'ArrowLeft')  { moveLightbox(-1); return; }
        if (e.key === 'ArrowRight') { moveLightbox(1);  return; }
        if (e.key === 'Escape')     { closeLightbox();  return; }
    }
    if (mediaModal?.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') {
        closeMediaModal();
    }
});

// ── media collection ──

function collectAllMedia(messages) {
    // Cache by message-count; sufficient since messages don't change within a loaded conversation
    if (__mediaItemsCache && __mediaItemsCacheKey === messages.length) return __mediaItemsCache;

    const mediaLookup = getMediaLookupMap();
    const items = [];
    messages.forEach((msg, msgIdx) => {
        const sender = msg.senderName || msg.sender_name || 'Unknown';
        const timestamp = msg.timestamp || msg.timestamp_ms || 0;
        getMessageMedia(msg).forEach(media => {
            if (!media.uri) return;
            const fileName = media.uri.split(/[\\\/]/).pop().toLowerCase();
            const matchingFile = mediaLookup.get(fileName) || null;
            const fileURL = matchingFile ? mediaFiles[matchingFile] : null;
            const ext = fileName.split('.').pop().toLowerCase();
            const mediaType = ext === 'mp4' ? 'video' : (matchingFile ? mediaTypes[matchingFile] : getMediaType(fileName));
            items.push({ fileName, fileURL, mediaType, sender, timestamp, msgIdx });
        });
    });

    __mediaItemsCache = items;
    __mediaItemsCacheKey = messages.length;
    return items;
}

// ── gallery ──

function openMediaGallery() {
    if (!window.currentChatData) return;
    const allItems = collectAllMedia(window.currentChatData.messages || []);
    const notFoundCount = allItems.filter(i => !i.fileURL).length;
    __galleryItems = allItems.filter(i => i.fileURL);
    __galleryRenderedCount = 0;

    if (mediaModalStats) {
        const extra = notFoundCount > 0 ? ' \u00b7 ' + notFoundCount + ' not found' : '';
        mediaModalStats.textContent = __galleryItems.length + ' available' + extra;
    }

    if (__galleryObserver) { __galleryObserver.disconnect(); __galleryObserver = null; }
    __gallerySentinel = null;
    mediaModalGrid.innerHTML = '';

    if (!__galleryItems.length) {
        mediaModalGrid.innerHTML = '<div style="padding:20px;color:var(--muted)">No media in this conversation.</div>';
        mediaModal.setAttribute('aria-hidden', 'false');
        return;
    }

    __gallerySentinel = document.createElement('div');
    __gallerySentinel.style.cssText = 'height:1px; grid-column:1/-1;';
    mediaModalGrid.appendChild(__gallerySentinel);

    __galleryObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) renderGalleryBatch();
    }, { root: mediaModalGrid, rootMargin: '400px' });
    __galleryObserver.observe(__gallerySentinel);

    renderGalleryBatch();
    mediaModal.setAttribute('aria-hidden', 'false');
}

function renderGalleryBatch() {
    const start = __galleryRenderedCount;
    const end = Math.min(start + GALLERY_BATCH, __galleryItems.length);
    if (start >= __galleryItems.length) return;

    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) frag.appendChild(buildGalleryThumb(__galleryItems[i], i));

    if (__gallerySentinel?.parentNode) {
        mediaModalGrid.insertBefore(frag, __gallerySentinel);
    } else {
        mediaModalGrid.appendChild(frag);
    }
    __galleryRenderedCount = end;

    if (__galleryRenderedCount >= __galleryItems.length) {
        if (__galleryObserver) { __galleryObserver.disconnect(); __galleryObserver = null; }
        if (__gallerySentinel) { __gallerySentinel.remove(); __gallerySentinel = null; }
    }
}

function buildGalleryThumb(item, idx) {
    const thumb = document.createElement('div');
    thumb.className = 'media-thumb';

    if (item.mediaType === 'image') {
        const img = document.createElement('img');
        img.src = item.fileURL;
        img.alt = item.fileName;
        thumb.appendChild(img);
        thumb.appendChild(buildThumbOverlay(item));

    } else if (item.mediaType === 'video') {
        const icon = document.createElement('div');
        icon.className = 'media-thumb-video-icon';
        icon.innerHTML = `<span class="thumb-play">&#9654;</span><span class="thumb-label">${escapeHtml(item.fileName)}</span>`;
        thumb.appendChild(icon);
        thumb.appendChild(buildThumbOverlay(item));

    } else if (item.mediaType === 'audio') {
        const inner = document.createElement('div');
        inner.className = 'media-thumb-audio';
        inner.innerHTML = `<span style="font-size:28px">&#127925;</span><span>${escapeHtml(item.fileName)}</span>`;
        thumb.appendChild(inner);
    }

    thumb.addEventListener('click', () => openLightbox(idx));
    return thumb;
}

function buildThumbOverlay(item) {
    const overlay = document.createElement('div');
    overlay.className = 'media-thumb-overlay';
    const info = document.createElement('div');
    info.className = 'media-thumb-info';
    info.style.whiteSpace = 'pre-line';
    info.textContent = `${item.sender}\n${new Date(item.timestamp).toLocaleDateString()}`;
    overlay.appendChild(info);
    return overlay;
}

function closeMediaModal() {
    if (mediaModal) mediaModal.setAttribute('aria-hidden', 'true');
    if (__galleryObserver) { __galleryObserver.disconnect(); __galleryObserver = null; }
    if (__gallerySentinel) { __gallerySentinel.remove(); __gallerySentinel = null; }
    __galleryRenderedCount = 0;
}

// ── lightbox ──

function openLightbox(idx) {
    __lbIndex = idx;
    renderLightboxItem();
    if (mediaLightbox) mediaLightbox.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
    if (mediaLightbox) mediaLightbox.setAttribute('aria-hidden', 'true');
    mediaLbMain.querySelectorAll('video, audio').forEach(el => { try { el.pause(); el.currentTime = 0; } catch (e) {} });
    mediaLbMain.innerHTML = '';
}

function moveLightbox(dir) {
    const next = __lbIndex + dir;
    if (next >= 0 && next < __galleryItems.length) {
        __lbIndex = next;
        renderLightboxItem();
    }
}

function renderLightboxItem() {
    const item = __galleryItems[__lbIndex];
    if (!item) return;

    mediaLbMain.querySelectorAll('video, audio').forEach(el => { try { el.pause(); } catch (e) {} });
    mediaLbMain.innerHTML = '';

    if (item.mediaType === 'image') {
        const img = document.createElement('img');
        img.src = item.fileURL;
        img.alt = item.fileName;
        mediaLbMain.appendChild(img);

    } else if (item.mediaType === 'video') {
        const video = document.createElement('video');
        video.src = item.fileURL;
        video.controls = true;
        video.autoplay = true;
        mediaLbMain.appendChild(video);

    } else if (item.mediaType === 'audio') {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;color:#fff';
        wrap.innerHTML = `<span style="font-size:48px">\uD83C\uDFB5</span><span style="font-size:13px;opacity:.7">${escapeHtml(item.fileName)}</span>`;
        const audio = document.createElement('audio');
        audio.src = item.fileURL;
        audio.controls = true;
        audio.autoplay = true;
        wrap.appendChild(audio);
        mediaLbMain.appendChild(wrap);
    }

    const prevBtn = document.getElementById('mediaLbPrev');
    const nextBtn = document.getElementById('mediaLbNext');
    if (prevBtn) prevBtn.style.opacity = __lbIndex > 0 ? '1' : '0.2';
    if (nextBtn) nextBtn.style.opacity = __lbIndex < __galleryItems.length - 1 ? '1' : '0.2';

    if (mediaLbCaption) {
        mediaLbCaption.innerHTML = '';
        const info = document.createElement('span');
        info.textContent = `${item.sender} \u00b7 ${new Date(item.timestamp).toLocaleString()} \u00b7 ${__lbIndex + 1}/${__galleryItems.length}`;
        mediaLbCaption.appendChild(info);

        if (item.msgIdx != null) {
            const btn = document.createElement('button');
            btn.className = 'media-lb-goto';
            btn.textContent = 'Go to message \u2197';
            btn.addEventListener('click', () => {
                closeLightbox();
                closeMediaModal();
                jumpToMessage(item.msgIdx);
            });
            mediaLbCaption.appendChild(btn);
        }
    }
}
