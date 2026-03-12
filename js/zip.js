// ─────────────────────────────────────────────
// zip.js — ZIP upload and conversation sidebar
// ─────────────────────────────────────────────

let currentZip = null;
let isZipMode = false;
let __allConversations = [];
let __convSearchGen = 0;
let __convSearchTimer = null;

// ── event listeners ──
document.getElementById('zipInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleZipUpload(file);
    e.target.value = '';
});

document.getElementById('convSearch')?.addEventListener('input', (e) => {
    clearTimeout(__convSearchTimer);
    const val = e.target.value;
    __convSearchTimer = setTimeout(() => filterConvList(val), 450);
});

// ── ZIP loading ──

async function handleZipUpload(file) {
    if (!file) return;
    if (!window.JSZip) { alert('JSZip library not loaded. Check your internet connection.'); return; }

    const loading = document.getElementById('loading');
    const chatContainer = document.getElementById('chat');
    const convList = document.getElementById('conv-list');
    const container = document.querySelector('.container');

    isZipMode = true;
    if (container) container.classList.add('zip-mode');
    if (convList) convList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Loading conversations\u2026</div>';
    loading.innerHTML = 'Reading ZIP\u2026';
    loading.style.display = 'flex';
    chatContainer.style.display = 'none';
    chatContainer.innerHTML = '';

    try {
        const zip = await JSZip.loadAsync(await file.arrayBuffer());
        currentZip = zip;

        loading.innerHTML = 'Loading media\u2026';
        await loadMediaFromZip(zip);

        loading.innerHTML = 'Parsing conversations\u2026';
        const jsonEntries = Object.entries(zip.files).filter(([path, entry]) =>
            !entry.dir && path.endsWith('.json') &&
            (!path.includes('/') || /\/message_\d+\.json$/i.test(path))
        );

        if (!jsonEntries.length) {
            loading.innerHTML = 'No JSON files found. Make sure this is a Facebook messages export (expects message_N.json files).';
            loading.style.display = 'flex';
            return;
        }

        const conversations = [];
        for (const [path, entry] of jsonEntries) {
            const text = await entry.async('string');
            const meta = parseConvMetadata(text, path);
            try { meta.parsedMessages = parseMessages(text); } catch (e) { meta.parsedMessages = null; }
            conversations.push(meta);
        }

        conversations.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        __allConversations = conversations;
        buildConvList(conversations);

        loading.innerHTML = 'Select a conversation from the list';
        loading.style.display = 'flex';

    } catch (err) {
        console.error('ZIP error:', err);
        loading.innerHTML = 'Error reading ZIP: ' + escapeHtml(String(err.message || err));
        loading.style.display = 'flex';
    }
}

async function loadMediaFromZip(zip) {
    resetMedia();
    const mediaEntries = Object.entries(zip.files).filter(([path, entry]) =>
        !entry.dir && path.toLowerCase().startsWith('media/')
    );
    const BATCH = 10;
    for (let i = 0; i < mediaEntries.length; i += BATCH) {
        await Promise.all(mediaEntries.slice(i, i + BATCH).map(async ([path, entry]) => {
            try {
                const fileName = path.split('/').pop().toLowerCase();
                const mimeType = getMimeTypeStr(fileName);
                const rawBlob = await entry.async('blob');
                const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
                mediaFiles[fileName] = URL.createObjectURL(blob);
                mediaTypes[fileName] = getMediaType(fileName);
            } catch (e) { /* skip broken entries */ }
        }));
        await yieldToUi();
    }
}

// ── conversation metadata ──

function parseConvMetadata(jsonText, filename) {
    try {
        const { data, isThreadPath } = decodeMessengerJson(jsonText);
        const messages = data.messages || [];
        const title = data.threadName || data.title || data.threadPath || filename.replace(/\.json$/i, '');
        // thread_path format stores newest at index 0; other format stores newest at [length-1]
        const lastMsg = isThreadPath ? messages[0] : messages[messages.length - 1];
        const lastTimestamp = lastMsg ? (lastMsg.timestamp || lastMsg.timestamp_ms || 0) : 0;
        const lastText = lastMsg ? (lastMsg.text || lastMsg.content || '') : '';
        const preview = lastText ? String(lastText).slice(0, 60) : (lastMsg ? '[Media]' : '');
        return { title, lastTimestamp, preview, messageCount: messages.length, filename, jsonText };
    } catch (e) {
        return { title: filename.replace(/\.json$/i, ''), lastTimestamp: 0, preview: '', messageCount: 0, filename, jsonText };
    }
}

function parseMessages(jsonText) {
    const { data, isThreadPath } = decodeMessengerJson(jsonText);
    if (isThreadPath) data.messages = [...data.messages].reverse();
    return data.messages || [];
}

// ── conversation list UI ──

function buildConvList(conversations) {
    const convList = document.getElementById('conv-list');
    if (!convList) return;
    convList.innerHTML = '';

    if (!conversations.length) {
        convList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">No conversations found</div>';
        return;
    }

    conversations.forEach(conv => {
        const item = document.createElement('div');
        item.className = 'conv-item';
        item.dataset.name = (conv.title || '').toLowerCase();

        item.innerHTML = `
            <div class="conv-avatar">${escapeHtml((conv.title || '?').charAt(0).toUpperCase())}</div>
            <div class="conv-meta">
                <div class="conv-name">${escapeHtml(conv.title)}</div>
                <div class="conv-preview">${escapeHtml(conv.preview)}</div>
            </div>
            <div class="conv-date">${escapeHtml(conv.lastTimestamp ? formatConvDate(conv.lastTimestamp) : '')}</div>
        `;

        item.addEventListener('click', () => loadConversation(conv, item));
        convList.appendChild(item);
    });
}

function filterConvList(query) {
    const q = (query || '').trim();
    if (!q) {
        __convSearchGen++;
        if (__allConversations.length) buildConvList(__allConversations);
        return;
    }
    if (__allConversations.length) {
        searchAllConversations(q);
    } else {
        const qLow = q.toLowerCase();
        document.querySelectorAll('#conv-list .conv-item').forEach(item => {
            item.style.display = (item.dataset.name || '').includes(qLow) ? '' : 'none';
        });
    }
}

function loadConversation(conv, itemEl, afterLoad = null) {
    try { resetSearchState(); } catch (e) {}

    document.querySelectorAll('#conv-list .conv-item').forEach(el => el.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');

    const options = document.getElementsByClassName('options')[0];
    if (options) options.style.display = 'block';

    processFileContent(conv.jsonText);
    if (afterLoad) setTimeout(afterLoad, 160);
}

// ── cross-conversation content search ──

async function searchAllConversations(query) {
    const myGen = ++__convSearchGen;
    await yieldToUi();
    if (myGen !== __convSearchGen) return;

    const qNorm = normalizeForSearch(query);
    if (!qNorm) return;

    const convList = document.getElementById('conv-list');
    convList.innerHTML = '';

    const status = document.createElement('div');
    status.className = 'conv-search-status';
    status.textContent = 'Searching\u2026';
    convList.appendChild(status);

    let totalMatches = 0;
    let convsWithMatches = 0;

    for (const conv of __allConversations) {
        if (myGen !== __convSearchGen) return;

        let messages;
        try {
            messages = conv.parsedMessages || parseMessages(conv.jsonText);
        } catch (e) {
            await yieldToUi();
            continue;
        }

        const matches = [];
        for (let i = 0; i < messages.length; i++) {
            const text = String(messages[i].text || messages[i].content || '');
            if (!text) continue;
            if (normalizeForSearch(text).includes(qNorm)) {
                matches.push({
                    msgIdx: i,
                    text,
                    sender: messages[i].senderName || messages[i].sender_name || 'Unknown',
                    timestamp: messages[i].timestamp || messages[i].timestamp_ms || 0,
                });
            }
        }

        if (matches.length) {
            convsWithMatches++;
            totalMatches += matches.length;
            convList.appendChild(buildConvSearchGroup(conv, matches, query));
        }

        await yieldToUi();
        if (myGen !== __convSearchGen) return;

        const countLabel = totalMatches
            ? `${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${convsWithMatches} conversation${convsWithMatches !== 1 ? 's' : ''}\u2026`
            : 'Searching\u2026';
        status.textContent = countLabel;
    }

    status.textContent = totalMatches
        ? `${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${convsWithMatches} conversation${convsWithMatches !== 1 ? 's' : ''}`
        : 'No results found';
}

function getMatchSnippet(text, qNorm, maxLen = 140) {
    const norm = normalizeForSearch(text);
    const pos = norm.indexOf(qNorm);
    const start = pos <= 40 ? 0 : pos - 40;
    const end = Math.min(text.length, start + maxLen);
    return (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '');
}

function buildConvSearchGroup(conv, matches, query) {
    const qNorm = normalizeForSearch(query);
    const group = document.createElement('div');
    group.className = 'conv-search-group';

    const header = document.createElement('div');
    header.className = 'conv-search-group-header';
    header.textContent = conv.title;
    group.appendChild(header);

    matches.forEach(match => {
        const item = document.createElement('div');
        item.className = 'conv-search-result';
        item.innerHTML = `
            <div class="csr-snippet">${highlightText(getMatchSnippet(match.text, qNorm), query)}</div>
            <div class="csr-meta">${escapeHtml(match.sender)}\u00a0\u00b7\u00a0${new Date(match.timestamp).toLocaleDateString()}</div>
        `;
        item.addEventListener('click', () => loadConversation(conv, null, () => jumpToMessage(match.msgIdx)));
        group.appendChild(item);
    });

    return group;
}
