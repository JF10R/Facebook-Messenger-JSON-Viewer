// ─────────────────────────────────────────────
// chat.js — file loading, parsing, rendering
// ─────────────────────────────────────────────

let currentJsonFileName = null;
let currentJsonFileSize = null;
let currentJsonFileModified = null;

const CHUNK_SIZE = 50;
let renderedMessages = new Map();
let observer = null;

// ── file input ──
document.getElementById('fileInput').addEventListener('change', handleFileUpload);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // If a different file is selected, clear the search index.
    // Do NOT clear uploaded media — a single folder can be reused across multiple JSON files.
    if (currentJsonFileName && (
        currentJsonFileName !== file.name ||
        currentJsonFileSize !== file.size ||
        currentJsonFileModified !== file.lastModified
    )) {
        try { resetSearchState(); } catch (e) {}
    }

    currentJsonFileName = file.name;
    currentJsonFileSize = file.size;
    currentJsonFileModified = file.lastModified;

    const options = document.getElementsByClassName('options')[0];
    const loading = document.getElementById('loading');
    const chatContainer = document.getElementById('chat');

    options.style.display = 'block';
    loading.innerHTML = 'Loading...';
    loading.style.display = 'flex';
    chatContainer.scrollTop = 0;
    chatContainer.innerHTML = '';

    const reader = new FileReader();
    reader.onload = (e) => processFileContent(e.target.result);
    reader.readAsText(file, 'utf-8');
}

function processFileContent(content) {
    try {
        const { data, isThreadPath } = decodeMessengerJson(content);
        if (isThreadPath) data.messages = [...data.messages].reverse();
        setupChatInterface(data);
    } catch (error) {
        alert('Invalid JSON file!');
    }
}

function setupChatInterface(data) {
    window.currentChatData = data;
    __searchIndex = null;

    const participants = data.participants.map(p => (typeof p === 'string' ? p : p.name));
    const threadName = data.threadName || data.title || data.threadPath || 'Untitled';

    document.getElementById('threadName').textContent = threadName;

    const mgBtn = document.getElementById('mediaGalleryBtn');
    if (mgBtn) mgBtn.style.display = '';

    setupRadioButtons(participants);
    setupCheckboxListeners();
    renderMessages(data, getSelectedPerspective());
}

function getSelectedPerspective() {
    return (document.querySelector('input[name="choice"]:checked') || {}).value;
}

function setupRadioButtons(participants) {
    const radioForm = document.getElementById('radioForm');
    radioForm.innerHTML = '';
    const saved = storageGet('selectedPerspective') || null;

    participants.forEach((participant, index) => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'choice';
        input.id = `option${index + 1}`;
        input.value = participant;
        if (saved && saved === participant) input.checked = true;
        else if (!saved && index === 0) input.checked = true;

        input.addEventListener('change', () => {
            try { storageSet('selectedPerspective', input.value); } catch (e) {}
            if (window.currentChatData) renderMessages(window.currentChatData, input.value);
        });

        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${participant}`));
        radioForm.appendChild(label);
    });
}

function setupCheckboxListeners() {
    const checkboxConfig = [
        { id: 'showTime',      class: '.timestamp' },
        { id: 'showMyName',    class: '.from-me .sender-name' },
        { id: 'showTheirName', class: '.from-them .sender-name' },
        { id: 'showReacts',    class: '.reaction' },
    ];

    checkboxConfig.forEach(({ id, class: className }) => {
        const input = document.getElementById(id);
        if (!input) return;
        try {
            const saved = storageGet('ui_' + id);
            if (saved !== null) input.checked = saved === '1';
        } catch (e) {}

        input.addEventListener('change', function () {
            document.querySelectorAll(className).forEach(el => (el.style.display = this.checked ? 'block' : 'none'));
            try { storageSet('ui_' + id, this.checked ? '1' : '0'); } catch (e) {}
        });

        input.dispatchEvent(new Event('change'));
    });
}

function renderMessages(data, selectedValue) {
    const chatContainer = document.getElementById('chat');
    const loading = document.getElementById('loading');

    chatContainer.style.display = 'none';
    loading.innerHTML = 'Loading messages...';
    loading.style.display = 'flex';

    if (observer) observer.disconnect();
    renderedMessages.clear();
    chatContainer.innerHTML = '';

    if (!data.messages.length) {
        loading.innerHTML = 'No messages';
        chatContainer.style.display = 'block';
        return;
    }

    const messageChunks = chunkArray(data.messages, CHUNK_SIZE);
    messageChunks.forEach((_, index) => {
        const chunkContainer = document.createElement('div');
        chunkContainer.classList.add('message-chunk');
        chunkContainer.dataset.chunkIndex = index;
        chatContainer.appendChild(chunkContainer);
    });

    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                renderChunk(parseInt(entry.target.dataset.chunkIndex), messageChunks[parseInt(entry.target.dataset.chunkIndex)], selectedValue);
            }
        });
    }, { root: chatContainer, threshold: 0.25, rootMargin: '100px' });

    document.querySelectorAll('.message-chunk').forEach(chunk => observer.observe(chunk));

    setTimeout(() => {
        loading.style.display = 'none';
        chatContainer.style.display = 'block';
    }, 100);
}

function renderChunk(chunkIndex, messages, selectedValue) {
    const chunkContainer = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
    if (!chunkContainer || renderedMessages.has(chunkIndex)) return;

    const highlightQuery = (searchInput && searchInput.value) ? searchInput.value : '';
    const frag = document.createDocumentFragment();

    messages.forEach((msg, localIdx) => {
        const globalIdx = chunkIndex * CHUNK_SIZE + localIdx;
        const div = document.createElement('div');
        const sender = getSenderName(msg);
        div.classList.add('message', sender === selectedValue ? 'from-me' : 'from-them');
        div.dataset.msgIndex = globalIdx;
        try { div.__rawMessage = msg; } catch (e) {}
        div.innerHTML = createMessageHTML(msg, highlightQuery);
        frag.appendChild(div);
    });

    chunkContainer.appendChild(frag);
    renderedMessages.set(chunkIndex, true);
    ['showTime', 'showMyName', 'showTheirName', 'showReacts'].forEach(id => {
        document.getElementById(id).dispatchEvent(new Event('change'));
    });
}

function createMessageHTML(msg, highlightQuery) {
    const sender = getSenderName(msg);
    const rawText = getMessageText(msg);
    const escaped = highlightQuery ? highlightText(String(rawText), highlightQuery) : escapeHtml(String(rawText));
    const text = escaped.replace(/\n/g, '<br>');
    const timestamp = msg.timestamp || msg.timestamp_ms || 0;
    const mediaItems = getMessageMedia(msg);

    return `
        <div class="sender-name">${escapeHtml(sender)}</div>
        <div class="message-content">
            ${text}
            ${mediaItems.map(media => {
                if (!media?.uri) return '';
                const { fileName, ext } = parseMediaFileName(media.uri);
                const matchingFile = findMediaFile(fileName);
                const fileURL = matchingFile ? mediaFiles[matchingFile] : null;
                const mediaType = resolveMediaType(ext, matchingFile);

                if (mediaType === 'image') {
                    return fileURL
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><img src="${fileURL}" alt="Image" class="preview"></a>`
                        : '[ Image not found ]';
                }
                if (mediaType === 'video') {
                    return fileURL
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><video controls class="preview-video"><source src="${fileURL}" type="video/mp4"></video></a>`
                        : '[ Video not found ]';
                }
                if (mediaType === 'audio') {
                    return fileURL
                        ? `<audio controls><source src="${fileURL}" type="audio/mpeg"></audio>`
                        : '[ Audio not found ]';
                }
                return '[ Media not found ]';
            }).join('')}
            ${msg.reactions?.length ? `<div class="reaction">${msg.reactions.map(r => `${escapeHtml(r.actor)}: ${escapeHtml(r.reaction)}`).join(', ')}</div>` : ''}
            <div class="timestamp">${new Date(timestamp).toLocaleString()}</div>
        </div>
    `;
}

// ── cleanup on page unload ──
window.addEventListener('beforeunload', () => {
    if (observer) observer.disconnect();
    resetMedia();
    renderedMessages.clear();
    try { if (window.__pdfState?.blobUrl) URL.revokeObjectURL(window.__pdfState.blobUrl); } catch (e) {}
});
