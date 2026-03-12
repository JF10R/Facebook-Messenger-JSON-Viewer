// Handle file upload
document.getElementById("fileInput").addEventListener("change", handleFileUpload);

// ZIP upload
document.getElementById('zipInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleZipUpload(file);
    e.target.value = ''; // allow re-selecting same file
});

// Conversation search (debounced)
let __convSearchTimer = null;
document.getElementById('convSearch')?.addEventListener('input', (e) => {
    clearTimeout(__convSearchTimer);
    const val = e.target.value;
    __convSearchTimer = setTimeout(() => filterConvList(val), 280);
});

// ZIP mode state
let currentZip = null;
let isZipMode = false;
let __allConversations = []; // full list set after ZIP load
let __convSearchAbort = false; // flag to cancel in-progress search

// ------------------ ZIP upload & conversation sidebar ------------------

async function handleZipUpload(file) {
    if (!file) return;
    if (!window.JSZip) {
        alert('JSZip library not loaded. Check your internet connection.');
        return;
    }

    const loading = document.getElementById('loading');
    const chatContainer = document.getElementById('chat');
    const convList = document.getElementById('conv-list');
    const container = document.querySelector('.container');

    // Enter ZIP mode
    isZipMode = true;
    if (container) container.classList.add('zip-mode');

    if (convList) convList.innerHTML = '<div style="padding:16px;color:var(--muted);font-size:13px">Loading conversations\u2026</div>';
    loading.innerHTML = 'Reading ZIP\u2026';
    loading.style.display = 'flex';
    chatContainer.style.display = 'none';
    chatContainer.innerHTML = '';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        currentZip = zip;

        // Load all media entries first
        loading.innerHTML = 'Loading media\u2026';
        await loadMediaFromZip(zip);

        // Find root-level JSON files (not inside subfolders)
        loading.innerHTML = 'Parsing conversations\u2026';
        const jsonEntries = Object.entries(zip.files).filter(([path, entry]) =>
            !entry.dir && path.endsWith('.json') && !path.includes('/')
        );

        if (!jsonEntries.length) {
            loading.innerHTML = 'No JSON files found in ZIP root. Make sure this is a Facebook messages export.';
            loading.style.display = 'flex';
            return;
        }

        // Parse metadata for each conversation
        const conversations = [];
        for (const [path, entry] of jsonEntries) {
            const text = await entry.async('string');
            const meta = parseConvMetadata(text, path);
            conversations.push(meta);
        }

        // Sort by most recent message first
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
    // Reset any previously loaded media before populating from ZIP
    resetMedia();

    const mediaEntries = Object.entries(zip.files).filter(([path, entry]) =>
        !entry.dir && path.toLowerCase().startsWith('media/')
    );

    const BATCH = 10;
    for (let i = 0; i < mediaEntries.length; i += BATCH) {
        const batch = mediaEntries.slice(i, i + BATCH);
        await Promise.all(batch.map(async ([path, entry]) => {
            try {
                const blob = await entry.async('blob');
                const url = URL.createObjectURL(blob);
                const fileName = path.split('/').pop().toLowerCase();
                mediaFiles[fileName] = url;
                mediaTypes[fileName] = getMediaType(fileName);
            } catch (e) { /* skip broken entries */ }
        }));
        // yield to UI periodically
        await new Promise(r => setTimeout(r, 0));
    }
}

function parseConvMetadata(jsonText, filename) {
    try {
        const isThreadPath = jsonText.includes('"thread_path"');
        let data;
        if (isThreadPath) {
            const replaced = jsonText.replace(/\\u00([a-f0-9]{2})|\\u([a-f0-9]{4})/gi, (match, p1, p2) => {
                const code = p1 ? parseInt(p1, 16) : parseInt(p2, 16);
                return String.fromCharCode(code);
            });
            data = JSON.parse(decodeURIComponent(escape(replaced)));
        } else {
            data = JSON.parse(jsonText);
        }

        const messages = data.messages || [];
        const title = data.threadName || data.title || data.threadPath || filename.replace(/\.json$/i, '');

        // thread_path format stores newest message at index 0 (processFileContent reverses them)
        // other format stores newest at messages[length-1]
        const lastMsg = isThreadPath ? messages[0] : messages[messages.length - 1];
        const lastTimestamp = lastMsg ? (lastMsg.timestamp || lastMsg.timestamp_ms || 0) : 0;
        const lastText = lastMsg ? (lastMsg.text || lastMsg.content || '') : '';
        const preview = lastText ? String(lastText).slice(0, 60) : (lastMsg ? '[Media]' : '');

        return { title, lastTimestamp, preview, messageCount: messages.length, filename, jsonText };
    } catch (e) {
        return { title: filename.replace(/\.json$/i, ''), lastTimestamp: 0, preview: '', messageCount: 0, filename, jsonText };
    }
}

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

        const initial = escapeHtml((conv.title || '?').charAt(0).toUpperCase());
        const date = conv.lastTimestamp ? formatConvDate(conv.lastTimestamp) : '';

        item.innerHTML = `
            <div class="conv-avatar">${initial}</div>
            <div class="conv-meta">
                <div class="conv-name">${escapeHtml(conv.title)}</div>
                <div class="conv-preview">${escapeHtml(conv.preview)}</div>
            </div>
            <div class="conv-date">${escapeHtml(date)}</div>
        `;

        item.addEventListener('click', () => loadConversation(conv, item));
        convList.appendChild(item);
    });
}

function formatConvDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function filterConvList(query) {
    const q = (query || '').trim();
    if (!q) {
        // Clear search: restore full conversation list
        __convSearchAbort = true;
        if (__allConversations.length) {
            buildConvList(__allConversations);
        } else {
            // Single-JSON mode: no-op (no conv items to restore)
        }
        return;
    }
    if (__allConversations.length) {
        // ZIP mode: full cross-conversation content search
        searchAllConversations(q);
    } else {
        // Single-JSON fallback: simple name filter
        const qLow = q.toLowerCase();
        document.querySelectorAll('#conv-list .conv-item').forEach(item => {
            item.style.display = (item.dataset.name || '').includes(qLow) ? '' : 'none';
        });
    }
}

// Parse messages from stored jsonText (same logic as processFileContent)
function parseMessages(jsonText) {
    const isTP = jsonText.includes('"thread_path"');
    let data;
    if (isTP) {
        const replaced = jsonText.replace(/\\u00([a-f0-9]{2})|\\u([a-f0-9]{4})/gi, (m, p1, p2) =>
            String.fromCharCode(p1 ? parseInt(p1, 16) : parseInt(p2, 16)));
        data = JSON.parse(decodeURIComponent(escape(replaced)));
        data.messages = data.messages.reverse(); // chronological, matches processFileContent
    } else {
        data = JSON.parse(jsonText);
    }
    return data.messages || [];
}

async function searchAllConversations(query) {
    // Signal any running search to stop, then take the flag for ourselves
    __convSearchAbort = true;
    await new Promise(r => setTimeout(r, 0));
    __convSearchAbort = false;

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
        if (__convSearchAbort) return;

        let messages;
        try {
            messages = parseMessages(conv.jsonText);
        } catch (e) {
            await new Promise(r => setTimeout(r, 0));
            continue;
        }

        const matches = [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const text = String(msg.text || msg.content || '');
            if (!text) continue;
            if (normalizeForSearch(text).includes(qNorm)) {
                matches.push({
                    msgIdx: i,
                    text,
                    sender: msg.senderName || msg.sender_name || 'Unknown',
                    timestamp: msg.timestamp || msg.timestamp_ms || 0,
                });
            }
        }

        if (matches.length) {
            convsWithMatches++;
            totalMatches += matches.length;
            convList.appendChild(buildConvSearchGroup(conv, matches, query));
        }

        // Yield to UI after each conversation so results stream in visibly
        await new Promise(r => setTimeout(r, 0));
        if (__convSearchAbort) return;

        status.textContent = totalMatches
            ? `${totalMatches} result${totalMatches !== 1 ? 's' : ''} in ${convsWithMatches} conversation${convsWithMatches !== 1 ? 's' : ''}\u2026`
            : 'Searching\u2026';
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
    const prefix = start > 0 ? '\u2026' : '';
    const suffix = end < text.length ? '\u2026' : '';
    return prefix + text.slice(start, end) + suffix;
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

        const snippet = getMatchSnippet(match.text, qNorm);
        const highlighted = highlightText(snippet, query);
        const date = new Date(match.timestamp).toLocaleDateString();

        item.innerHTML = `<div class="csr-snippet">${highlighted}</div><div class="csr-meta">${escapeHtml(match.sender)}\u00a0\u00b7\u00a0${date}</div>`;

        item.addEventListener('click', () => {
            loadConversation(conv, null, () => jumpToMessage(match.msgIdx));
        });
        group.appendChild(item);
    });

    return group;
}

function loadConversation(conv, itemEl, afterLoad = null) {
    // Reset search state
    try { __searchIndex = null; } catch (e) {}
    try { if (searchInput) searchInput.value = ''; } catch (e) {}
    try { if (searchResultsEl) { searchResultsEl.innerHTML = ''; searchResultsEl.style.display = 'none'; } } catch (e) {}
    try {
        if (searchProgress) {
            searchProgress.querySelector('.fill').style.width = '0%';
            searchProgress.querySelector('.progress-text').innerText = 'Idle';
            searchProgress.style.display = 'none';
        }
    } catch (e) {}

    // Mark active item (conv-items may not be visible during search results view)
    document.querySelectorAll('#conv-list .conv-item').forEach(el => el.classList.remove('active'));
    if (itemEl) itemEl.classList.add('active');

    // Show options panel
    const options = document.getElementsByClassName('options')[0];
    if (options) options.style.display = 'block';

    // Load conversation via existing parser
    processFileContent(conv.jsonText);

    // afterLoad fires after renderMessages' 100ms display timeout settles
    if (afterLoad) setTimeout(afterLoad, 160);
}

let currentJsonFileName = null;
let currentJsonFileSize = null;
let currentJsonFileModified = null;
const CHUNK_SIZE = 50;
let renderedMessages = new Map();
let observer = null;

let __pdfState = {
    running: false,
    cancel: false,
    blobUrl: null,
    fileName: null
};

// Storage wrapper: namespace keys and fallback to cookies if localStorage unavailable
const STORAGE_PREFIX = 'fmjv_' + (window.location.hostname || 'local') + '_';

function setCookie(name, value, days = 365) {
    try {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/';
    } catch(e) {}
}

function getCookie(name) {
    try {
        const cookies = document.cookie ? document.cookie.split('; ') : [];
        for (let c of cookies) {
            const [k,v] = c.split('=');
            if (decodeURIComponent(k) === name) return decodeURIComponent(v || '');
        }
    } catch(e) {}
    return null;
}

function storageSet(key, value) {
    const k = STORAGE_PREFIX + key;
    try { localStorage.setItem(k, String(value)); return; } catch(e) {}
    try { setCookie(k, String(value)); } catch(e) {}
}

function storageGet(key) {
    const k = STORAGE_PREFIX + key;
    try { const v = localStorage.getItem(k); if (v !== null) return v; } catch(e) {}
    try { const v = getCookie(k); if (v !== null) return v; } catch(e) {}
    return null;
}

function storageRemove(key) {
    const k = STORAGE_PREFIX + key;
    try { localStorage.removeItem(k); } catch(e) {}
    try { setCookie(k, '', -1); } catch(e) {}
}

function sanitizeFileName(name) {
    return String(name || 'conversation')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140) || 'conversation';
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // If a different file (by name, size or modified time) is selected, clear previous search index.
    // Do NOT clear uploaded media here so a single uploaded media folder can be reused across multiple JSON files.
    if (currentJsonFileName && (currentJsonFileName !== file.name || currentJsonFileSize !== file.size || currentJsonFileModified !== file.lastModified)) {
        try { __searchIndex = null; } catch(e){}
        try { if (searchInput) searchInput.value = ''; } catch(e){}
        try { if (searchResultsEl) searchResultsEl.innerHTML = ''; } catch(e){}
        try {
            if (searchProgress) {
                searchProgress.querySelector('.fill').style.width = '0%';
                searchProgress.querySelector('.progress-text').innerText = 'Idle';
                searchProgress.style.display = 'none';
            }
        } catch(e){}
    }

    currentJsonFileName = file.name;
    currentJsonFileSize = file.size;
    currentJsonFileModified = file.lastModified;

    const options = document.getElementsByClassName("options")[0];
    const loading = document.getElementById("loading");
    const chatContainer = document.getElementById("chat");

    options.style.display = "block";
    loading.innerHTML = "Loading...";
    loading.style.display = "flex";
    chatContainer.scrollTop = 0;
    chatContainer.innerHTML = "";

    const reader = new FileReader();
    reader.onload = (e) => processFileContent(e.target.result);
    reader.readAsText(file, 'utf-8');
}

function processFileContent(content) {
    try {
        let data;
        const isThreadPathFormat = content.includes('"thread_path"');

        if (isThreadPathFormat) {
            const replaced = content.replace(/\\u00([a-f0-9]{2})|\\u([a-f0-9]{4})/gi, (match, p1, p2) => {
                const code = p1 ? parseInt(p1, 16) : parseInt(p2, 16);
                return String.fromCharCode(code);
            });
            const decoded = decodeURIComponent(escape(replaced));
            data = JSON.parse(decoded);
            data.messages = data.messages.reverse();
        } else {
            data = JSON.parse(content);
        }
        setupChatInterface(data);
    } catch (error) {
        alert("Invalid JSON file!");
    }
}

function setupChatInterface(data) {
    window.currentChatData = data;
    // reset search index for new chat
    __searchIndex = null;

    const participants = data.participants.map(p => (typeof p === 'string' ? p : p.name));
    const threadName = data.threadName || data.title || data.threadPath || "Untitled";

    document.getElementById("threadName").innerText = threadName;

    // Show the media gallery button now that a conversation is loaded
    const mgBtn = document.getElementById('mediaGalleryBtn');
    if (mgBtn) mgBtn.style.display = '';

    setupRadioButtons(participants);

    // after building radios, determine selected
    let selectedValue = (document.querySelector('input[name="choice"]:checked') || {}).value;

    setupCheckboxListeners();
    // render using the selected perspective
    renderMessages(data, selectedValue);
}

function getSelectedPerspective() {
    return (document.querySelector('input[name="choice"]:checked') || {}).value;
}

function setupRadioButtons(participants) {
    const radioForm = document.getElementById("radioForm");
    radioForm.innerHTML = "";
    const saved = (storageGet('selectedPerspective') || null);
    participants.forEach((participant, index) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        
        input.type = "radio";
        input.name = "choice";
        input.id = `option${index + 1}`;
        input.value = participant;
        // restore saved selection if it matches, otherwise keep default on first
        if (saved && saved === participant) input.checked = true;
        else if (!saved && index === 0) input.checked = true;

        // when changed, persist and re-render using current chat data (if present)
        input.addEventListener('change', () => {
            try { storageSet('selectedPerspective', input.value); } catch(e){}
            if (window.currentChatData) renderMessages(window.currentChatData, input.value);
        });

        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${participant}`));
        
        radioForm.appendChild(label);
    });
}

function setupCheckboxListeners() {
    const checkboxConfig = [
        { id: "showTime", class: ".timestamp" },
        { id: "showMyName", class: ".from-me .sender-name" },
        { id: "showTheirName", class: ".from-them .sender-name" },
        { id: "showReacts", class: ".reaction" }
    ];

    checkboxConfig.forEach(({ id, class: className }) => {
        const input = document.getElementById(id);
        if (!input) return;
        // restore saved state
        try {
            const saved = storageGet('ui_' + id);
            if (saved !== null) {
                input.checked = saved === '1';
            }
        } catch(e) {}

        // listener to apply and persist
        input.addEventListener("change", function() {
            const elements = document.querySelectorAll(className);
            elements.forEach(el => el.style.display = this.checked ? "block" : "none");
            try { storageSet('ui_' + id, this.checked ? '1' : '0'); } catch(e){}
        });

        // trigger change once to apply initial visibility
        input.dispatchEvent(new Event('change'));
    });
}

function renderMessages(data, selectedValue) {
    const chatContainer = document.getElementById("chat");
    const loading = document.getElementById("loading");
    
    chatContainer.style.display = "none";
    loading.innerHTML = "Loading messages...";
    loading.style.display = "flex";
    
    if (observer) {
        observer.disconnect();
    }
    
    renderedMessages.clear();
    chatContainer.innerHTML = "";
    
    if (!data.messages.length) {
        loading.innerHTML = "No messages";
        chatContainer.style.display = "block";
        return;
    }

    const messageChunks = chunkArray(data.messages, CHUNK_SIZE);
    
    messageChunks.forEach((chunk, index) => {
        const chunkContainer = document.createElement("div");
        chunkContainer.classList.add("message-chunk");
        chunkContainer.dataset.chunkIndex = index;
        chatContainer.appendChild(chunkContainer);
    });

    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const chunkIndex = parseInt(entry.target.dataset.chunkIndex);
                renderChunk(chunkIndex, messageChunks[chunkIndex], selectedValue);
            }
        });
    }, {
        root: chatContainer,
        threshold: 0.1,
        rootMargin: "200px"
    });

    document.querySelectorAll(".message-chunk").forEach(chunk => {
        observer.observe(chunk);
    });

    setTimeout(() => {
        loading.style.display = "none";
        chatContainer.style.display = "block";
    }, 100);
}

// Media handling
let mediaFiles = {};
let mediaTypes = {};
const mediaFolderInput = document.getElementById("mediaFolder");

mediaFolderInput.addEventListener("change", function(event) {
    const files = event.target.files;
    if (!files.length) {
        return;
    }

    const chatContainer = document.getElementById("chat");
    const loading = document.getElementById("loading");
    chatContainer.style.display = "none";
    loading.innerHTML = "Processing media...";
    loading.style.display = "flex";

    processMediaFiles(files).then(() => {
        if (window.currentChatData) {
            renderMessages(window.currentChatData, 
                document.querySelector('input[name="choice"]:checked').value);
            loading.style.display = "none";
            chatContainer.style.display = "block";
        }
    });
});

async function processMediaFiles(files) {
    const BATCH_SIZE = 20;
    const fileArray = Array.from(files);
    
    resetMedia();
    
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
        const batch = fileArray.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(file => {
            return new Promise(resolve => {
                const fileURL = URL.createObjectURL(file);
                const relativePath = file.webkitRelativePath || file.name; // Preserve folder structure if available
                mediaFiles[relativePath] = fileURL;
                mediaTypes[relativePath] = getMediaType(file.name);
                resolve();
            });
        }));
    }
    console.log("Media files processed:", Object.keys(mediaFiles));
}

function resetMedia() {
    Object.values(mediaFiles).forEach(url => URL.revokeObjectURL(url));
    mediaFiles = {};
    mediaTypes = {};
    __mediaLookupCache = null;
}

function getMediaType(filename) {
    const extension = filename.split('.').pop().toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) return "image";
    if (["mp4", "webm", "ogg"].includes(extension)) return "video";
    if (["mp3", "wav", "aac", "ogg"].includes(extension)) return "audio";
    return "unknown";
}

// O(1) media lookup: maps lowercased filename → full key in mediaFiles
let __mediaLookupCache = null;
function getMediaLookupMap() {
    if (__mediaLookupCache) return __mediaLookupCache;
    __mediaLookupCache = new Map();
    for (const key of Object.keys(mediaFiles)) {
        const fileName = key.toLowerCase().split(/[\\\/]/).pop();
        __mediaLookupCache.set(fileName, key);
    }
    return __mediaLookupCache;
}

function findMediaFile(fileName) {
    const map = getMediaLookupMap();
    return map.get(fileName.toLowerCase()) || null;
}

// Highlight helpers: diacritic-insensitive matching by building a normalized mapping
function buildNormalizedMap(original) {
    const mapping = []; // mapping[normalizedPos] = originalIndex
    let normalized = '';
    for (let i = 0; i < original.length; i++) {
        const ch = original[i];
        const n = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '');
        for (let k = 0; k < n.length; k++) {
            mapping.push(i);
            normalized += n[k];
        }
    }
    return { normalized: normalized.toLowerCase(), mapping };
}

function findRangesForToken(original, tokenNorm) {
    const { normalized, mapping } = buildNormalizedMap(original);
    const token = tokenNorm;
    const ranges = [];
    let start = 0;
    while (true) {
        const idx = normalized.indexOf(token, start);
        if (idx === -1) break;
        const origStart = mapping[idx];
        const origEnd = mapping[idx + token.length - 1] + 1; // exclusive
        ranges.push([origStart, origEnd]);
        start = idx + token.length;
    }
    return ranges;
}

function mergeRanges(ranges) {
    if (!ranges.length) return [];
    ranges.sort((a,b)=>a[0]-b[0]);
    const out = [ranges[0].slice()];
    for (let i = 1; i < ranges.length; i++) {
        const cur = ranges[i];
        const last = out[out.length-1];
        if (cur[0] <= last[1]) {
            last[1] = Math.max(last[1], cur[1]);
        } else out.push(cur.slice());
    }
    return out;
}

function highlightText(original, query) {
    if (!query || !original) return escapeHtml(original);
    const qNorm = normalizeForSearch(query);
    const tokens = qNorm.split(' ').filter(Boolean);
    if (!tokens.length) return escapeHtml(original);

    let allRanges = [];
    for (const t of tokens) {
        const ranges = findRangesForToken(original, t);
        allRanges = allRanges.concat(ranges);
    }
    if (!allRanges.length) return escapeHtml(original);
    const merged = mergeRanges(allRanges);
    // build HTML with <strong>
    let out = '';
    let lastIdx = 0;
    for (const [s,e] of merged) {
        out += escapeHtml(original.slice(lastIdx, s));
        out += '<strong>' + escapeHtml(original.slice(s, e)) + '</strong>';
        lastIdx = e;
    }
    out += escapeHtml(original.slice(lastIdx));
    return out;
}

function createMessageHTML(msg, highlightQuery) {
    const sender = msg.senderName || msg.sender_name || "Unknown";
    const rawText = msg.text || msg.content || "";
    const text = highlightQuery ? highlightText(String(rawText), highlightQuery) : escapeHtml(String(rawText));
    const timestamp = msg.timestamp || msg.timestamp_ms || 0;
    // Combine all possible media arrays
    const mediaItems = [].concat(
        msg.media || [],
        msg.photos || [],
        msg.videos || [],
        msg.audio || [],
        msg.audio_files || [], // Add support for audio_files
        msg.gifs || []
    );

    return `
        <div class="sender-name">${escapeHtml(sender)}</div>
        <div class="message-content">
            ${text}
            ${mediaItems.map(media => {
                const fileName = media.uri.split(/[\\\/]/).pop().toLowerCase(); // Normalize to lowercase
                const matchingFile = findMediaFile(fileName);
                const fileURL = matchingFile ? mediaFiles[matchingFile] : null;
                // Determine media type based on file extension, overriding JSON context if needed
                const extension = fileName.split('.').pop().toLowerCase();
                const mediaType = extension === "mp4" ? "video" : (matchingFile ? mediaTypes[matchingFile] : getMediaType(fileName));

                if (mediaType === "image") {
                    return fileURL 
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><img src="${fileURL}" alt="Image" class="preview"></a>`
                        : `[ Image not found ]`;
                } else if (mediaType === "video") {
                    return fileURL
                        ? `<a href="${fileURL}" target="_blank" class="media-preview"><video controls class="preview-video"><source src="${fileURL}" type="video/mp4"></video></a>`
                        : `[ Video not found ]`;
                } else if (mediaType === "audio") {
                    return fileURL
                        ? `<audio controls><source src="${fileURL}" type="audio/mpeg"></audio>`
                        : `[ Audio not found ]`;
                }
                return `[ Media not found ]`;
            }).join("")}
            ${msg.reactions?.length ? `<div class="reaction">${msg.reactions.map(r => `${escapeHtml(r.actor)}: ${escapeHtml(r.reaction)}`).join(", ")}</div>` : ""}
            <div class="timestamp">${new Date(timestamp).toLocaleString()}</div>
        </div>
    `;
}

function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

window.addEventListener("beforeunload", () => {
    if (observer) observer.disconnect();
    Object.values(mediaFiles).forEach(url => URL.revokeObjectURL(url));
    renderedMessages.clear();
    try { if (__pdfState.blobUrl) URL.revokeObjectURL(__pdfState.blobUrl); } catch(e) {}
});

// ------------------ Search implementation ------------------
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const searchResultsEl = document.getElementById('searchResults');
const searchProgress = document.getElementById('searchProgress');

// hide results by default until an explicit search runs
if (searchResultsEl) searchResultsEl.style.display = 'none';

// Small utility: normalize strings (lowercase, remove diacritics, collapse whitespace)
function normalizeForSearch(str) {
    if (!str) return '';
    // Unicode normalize and remove diacritics
    const normalized = str.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Build a lightweight search index when messages are loaded
function buildSearchIndex(messages) {
    // index: array of { text, normalized, sender, timestamp, idx }
    const idx = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const parts = [];
        if (m.text) parts.push(typeof m.text === 'string' ? m.text : (m.content || ''));
        if (m.content) parts.push(m.content);
        if (m.senderName) parts.push(m.senderName);
        // include reactions summary
        if (m.reactions && m.reactions.length) parts.push(m.reactions.map(r => r.reaction + ' ' + (r.actor||'')).join(' '));
        // include media filenames
        const mediaItems = [].concat(m.media || [], m.photos || [], m.videos || [], m.audio || [], m.audio_files || [], m.gifs || []);
        mediaItems.forEach(mi => { if (mi && mi.uri) parts.push(mi.uri); });

        const text = parts.join(' ');
        idx.push({ text, normalized: normalizeForSearch(text), sender: m.senderName || m.sender_name || 'Unknown', timestamp: m.timestamp || m.timestamp_ms || 0, idx: i });
    }
    return idx;
}

// Simple fuzzy scoring: combination of substring match, token overlap, and Levenshtein distance on small strings
function fuzzyScore(query, target) {
    if (!query || !target) return 0;
    if (target.includes(query)) return 100 + Math.min(50, query.length); // strong boost for substring

    // token overlap
    const qTokens = query.split(' ');
    const tTokens = target.split(' ');
    let overlap = 0;
    for (const qt of qTokens) {
        for (const tt of tTokens) {
            if (tt.includes(qt) || qt.includes(tt)) { overlap += 1; break; }
        }
    }
    const tokenScore = overlap * 10;

    // small Levenshtein distance for short tokens (cheap implementation)
    function lev(a,b){
        const m=a.length,n=b.length; if(m*n===0) return m+n; const dp = Array(m+1).fill(0).map(()=>Array(n+1).fill(0));
        for(let i=0;i<=m;i++) dp[i][0]=i; for(let j=0;j<=n;j++) dp[0][j]=j;
        for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+1);
        return dp[m][n];
    }

    const shortQuery = query.length > 30 ? query.slice(0,30) : query;
    const dist = lev(shortQuery, target.slice(0, shortQuery.length+10));
    const distScore = Math.max(0, 30 - dist);

    return tokenScore + distScore;
}

// Asynchronous batched search to keep UI responsive and report progress
async function performSearch(query, index, onProgress) {
    const results = [];
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) return results;

    const BATCH = 500; // tuned for responsiveness
    for (let i = 0; i < index.length; i += BATCH) {
        const batch = index.slice(i, i + BATCH);
        for (const item of batch) {
            const score = fuzzyScore(normalizedQuery, item.normalized);
            if (score > 0) results.push({ score, item });
        }
        if (onProgress) onProgress(Math.min(100, Math.round(((i + BATCH) / index.length) * 100)));
        // yield to UI
        await new Promise(r => setTimeout(r, 0));
    }
    results.sort((a,b) => b.score - a.score);
    return results;
}

// Global search index
let __searchIndex = null;

// Hook up search actions
searchBtn?.addEventListener('click', startSearch);
searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') startSearch(); });
const clearSearchBtn = document.getElementById('clearSearchBtn');
clearSearchBtn?.addEventListener('click', clearSearch);

// Update highlights live when user edits the search box (but debounce)
let _highlightTimeout = null;
searchInput?.addEventListener('input', () => {
    clearTimeout(_highlightTimeout);
    _highlightTimeout = setTimeout(() => {
        const q = (searchInput.value || '').trim();
        // if input cleared, hide results box
        if (!q) {
            if (searchResultsEl) searchResultsEl.style.display = 'none';
        }
        updateHighlightsAcrossDOM(q);
    }, 250);
});

async function startSearch() {
    const q = searchInput.value || '';
    if (!window.currentChatData || !window.currentChatData.messages) return;

    // build index lazily
    if (!__searchIndex) {
        searchProgress.style.display = 'flex';
        searchProgress.querySelector('.progress-text').innerText = 'Indexing...';
        await new Promise(r => setTimeout(r, 0));
        __searchIndex = buildSearchIndex(window.currentChatData.messages);
    }

    // perform search
    searchProgress.style.display = 'flex';
    searchProgress.querySelector('.fill').style.width = '0%';
    searchProgress.querySelector('.progress-text').innerText = 'Searching...';
    searchResultsEl.innerHTML = '';
    if (searchResultsEl) searchResultsEl.style.display = 'block';

    const results = await performSearch(q, __searchIndex, (p) => {
        searchProgress.querySelector('.fill').style.width = p + '%';
        searchProgress.querySelector('.progress-text').innerText = `Searching ${p}%`;
    });

    // done
    searchProgress.querySelector('.fill').style.width = '100%';
    searchProgress.querySelector('.progress-text').innerText = `Found ${results.length} matches`;
    setTimeout(()=>{ searchProgress.style.display = 'none'; }, 800);

    // show top results
    if (!results.length) {
        searchResultsEl.innerHTML = '<div class="search-result-item">No results</div>';
        return;
    }

    const maxResults = Math.min(50, results.length);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < maxResults; i++) {
        const r = results[i];
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.dataset.idx = r.item.idx;
        const time = new Date(r.item.timestamp).toLocaleString();
        // Use the original message text/content for snippet (avoid sender/reactions that were added to the index)
        const originalMsg = (window.currentChatData && window.currentChatData.messages && window.currentChatData.messages[r.item.idx]) || null;
        const rawText = originalMsg ? (originalMsg.text || originalMsg.content || '') : (r.item.text || '');
        const rawSnippet = String(rawText).slice(0, 240);
        const highlightedSnippet = highlightText(rawSnippet, q);
    el.innerHTML = `<div class="snippet">${highlightedSnippet}</div><div class="meta">${escapeHtml(r.item.sender)} • ${time}</div>`;
        el.addEventListener('click', () => jumpToMessage(r.item.idx));
        frag.appendChild(el);
    }
    searchResultsEl.appendChild(frag);

    // Also update currently rendered chunks to show highlights for the active query
    updateHighlightsAcrossDOM(q);
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;" })[c]); }

// Jump to message index: ensure its chunk is rendered, scroll into view and highlight transiently
async function jumpToMessage(messageIndex) {
    const chatContainer = document.getElementById('chat');
    // compute which chunk
    const chunkIndex = Math.floor(messageIndex / CHUNK_SIZE);

    // render that chunk synchronously if not yet rendered
    const chunkContainer = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
    if (chunkContainer && !renderedMessages.has(chunkIndex)) {
        // find data.messages slice
        const start = chunkIndex * CHUNK_SIZE;
        const msgs = window.currentChatData.messages.slice(start, start + CHUNK_SIZE);
        renderChunk(chunkIndex, msgs, document.querySelector('input[name="choice"]:checked').value);
    }

    // small timeout to allow DOM update
    await new Promise(r => setTimeout(r, 20));

    // select the message element within the chunk
    // messages are appended in order; find the Nth message within earlier chunks
    let cumulative = 0;
    for (let i = 0; i <= chunkIndex; i++) {
        const c = document.querySelector(`.message-chunk[data-chunk-index="${i}"]`);
        if (!c) continue;
        const count = c.querySelectorAll('.message').length;
        cumulative += count;
    }

    // Find the global message element by data attribute: we'll mark message elements with data-msg-index when rendering
    const msgEl = document.querySelector(`.message[data-msg-index="${messageIndex}"]`);
    if (!msgEl) {
        // try to search inside chunk by approximate position
        const chunk = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
        if (chunk) {
            const children = Array.from(chunk.querySelectorAll('.message'));
            const localIdx = messageIndex - chunkIndex * CHUNK_SIZE;
            const candidate = children[localIdx] || children[Math.max(0, localIdx-1)];
            if (candidate) {
                await scrollAndHighlight(candidate);
                return;
            }
        }
        return;
    }
    await scrollAndHighlight(msgEl);
}

function clearSearch() {
    if (searchInput) searchInput.value = '';
    searchResultsEl.innerHTML = '';
    if (searchResultsEl) searchResultsEl.style.display = 'none';
    if (searchProgress) {
        searchProgress.querySelector('.fill').style.width = '0%';
        searchProgress.querySelector('.progress-text').innerText = 'Idle';
        searchProgress.style.display = 'none';
    }
    updateHighlightsAcrossDOM('');
}

// Re-render highlights inside already-rendered message DOM nodes without reconstructing everything
function updateHighlightsAcrossDOM(query) {
    // For each rendered .message, find its text node(s) inside .message-content and replace innerHTML accordingly
    const msgEls = document.querySelectorAll('.message');
    const q = query || '';
    msgEls.forEach(el => {
        // find original text: try to reconstruct from dataset or fallback to current textContent
        // We didn't store raw text per element, so safely re-extract from the current DOM but first strip existing <strong>
        const contentEl = el.querySelector('.message-content');
        if (!contentEl) return;
        // Build a plain-text by cloning and removing strong tags
        const clone = contentEl.cloneNode(true);
    // remove media previews and reactions/timestamp to preserve them
    // note: do NOT remove <video> separately because videos are wrapped in .media-preview anchors;
    // removing both the anchor and video then re-inserting both causes duplication.
    const mediaEls = clone.querySelectorAll('.media-preview, audio, .preview, .reaction, .timestamp');
        mediaEls.forEach(n => n.remove());
        // remove strong tags
        const strongs = clone.querySelectorAll('strong');
        strongs.forEach(s => {
            const txt = document.createTextNode(s.textContent);
            s.parentNode.replaceChild(txt, s);
        });
        const plain = clone.textContent || '';
        // Highlight plain text
        const newHTML = highlightText(plain, q);
        // Rebuild content area: keep media/reactions/timestamp from original content
        // Get original extras
        const originalContent = contentEl;
        const extras = [];
        // Collect only top-level media containers (exclude inner .preview img to avoid duplication)
        const seen = new Set();
        // collect only top-level media containers (anchors .media-preview) and audio/reaction/timestamp
        originalContent.querySelectorAll('.media-preview, audio, .reaction, .timestamp').forEach(n => {
            const html = n.outerHTML;
            if (!seen.has(html)) {
                seen.add(html);
                extras.push(html);
            }
        });
        // Set new HTML
        originalContent.innerHTML = newHTML + extras.join('');
    });
}

function scrollIntoViewWithPadding(container, element, padding = 60) {
    const containerRect = container.getBoundingClientRect();
    const elRect = element.getBoundingClientRect();
    const offset = (elRect.top - containerRect.top) - padding;
    container.scrollTop += offset;
}

async function scrollAndHighlight(el) {
    const chatContainer = document.getElementById('chat');
    // ensure surrounding messages visible: scroll so that target is centered
    scrollIntoViewWithPadding(chatContainer, el, 120);

    // add highlight classes
    el.classList.add('highlight-target');
    el.classList.add('temporary-highlight');
    // remove temporary after animation
    setTimeout(() => { el.classList.remove('temporary-highlight'); }, 2200);
    // ensure still visible
    await new Promise(r => setTimeout(r, 300));
}

// Mark messages with data-msg-index during renderChunk
const originalRenderChunk = renderChunk;
function renderChunk(chunkIndex, messages, selectedValue) {
    // delegate to original but we need to set data-msg-index on each message element
    const chunkContainer = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
    if (!chunkContainer || renderedMessages.has(chunkIndex)) return;

    const highlightQuery = (searchInput && searchInput.value) ? searchInput.value : '';
    messages.forEach((msg, localIdx) => {
        const globalIdx = chunkIndex * CHUNK_SIZE + localIdx;
        const div = document.createElement("div");
        const sender = msg.senderName || msg.sender_name || "Unknown";
        div.classList.add("message", sender === selectedValue ? "from-me" : "from-them");
        div.dataset.msgIndex = globalIdx;
        // attach raw message object for reliable re-rendering later
        try { div.__rawMessage = msg; } catch(e) { /* ignore */ }
        div.innerHTML = createMessageHTML(msg, highlightQuery);
        chunkContainer.appendChild(div);
    });

    renderedMessages.set(chunkIndex, true);
    ["showTime", "showMyName", "showTheirName", "showReacts"].forEach(id => {
        document.getElementById(id).dispatchEvent(new Event("change"));
    });
}

// Replace previous declaration by ensuring we don't double-define if hot-reloaded
try { window.__hasSearchPatch = true; } catch(e){}

// ------------------ Help tooltip & modal ------------------
const helpTexts = {
    perspective: {
        title: 'Góc nhìn (Perspective)',
        short: 'Chọn người mà giao diện sẽ hiển thị như thể bạn là người đó.',
        long: `Chọn một người tham gia để xem cuộc trò chuyện dưới góc nhìn của họ. Khi chọn, các tin nhắn của người đó sẽ được đánh dấu là "from-me" và tin nhắn còn lại là "from-them". Hữu ích khi bạn muốn đọc lại cuộc hội thoại như thể bạn đang ở vị trí một trong những người tham gia.`
    },
    customization: {
        title: 'Tùy chỉnh hiển thị',
        short: 'Bật/tắt tên, thời gian và biểu cảm (reactions).',
        long: `Sử dụng các checkbox để điều khiển việc hiển thị: tên người gửi, dấu thời gian và tóm tắt biểu cảm. "Hiện tên của tôi" sẽ hiển thị tên với các tin nhắn từ góc nhìn đã chọn; "Hiện tên họ" sẽ hiển thị tên người khác. "Hiện thời gian" và "Hiện biểu cảm" lần lượt bật/tắt thời gian và phần vòng biểu cảm.`
    },
    download: {
        title: 'Tải JSON từ Messenger',
        short: 'Cách xuất file JSON từ Facebook để mở bằng công cụ này.',
        long: `Để xuất cuộc trò chuyện, vào trang "Download Your Information" trên Facebook và chọn mục Messages trong phần dữ liệu cần tải. Sau khi Facebook hoàn tất, bạn sẽ nhận được file ZIP chứa JSON. Giải nén và chọn file JSON tương ứng để mở trong ứng dụng này. Lưu ý: một vài cuộc trò chuyện mã hoá đầu-cuối có thể yêu cầu thao tác đặc biệt.`
    }
};

const helpModal = document.getElementById('helpModal');
const helpBody = document.getElementById('helpBody');
const helpTitle = document.getElementById('helpTitle');
const helpClose = document.getElementById('helpClose');

function showHelpModal(key) {
    const info = helpTexts[key] || { title: 'Help', long: 'No help available.' };
    helpTitle.innerText = info.title;
    // Build a clearer modal body with a short summary and detailed paragraph
    const short = info.short ? `<p style="font-weight:600;margin-bottom:8px;">${escapeHtml(info.short)}</p>` : '';
    const long = info.long ? `<p>${escapeHtml(info.long)}</p>` : '';
    helpBody.innerHTML = short + long + `<div class="help-actions"><button class="secondary" onclick="closeHelpModal()">Đóng</button></div>`;
    if (helpModal) helpModal.setAttribute('aria-hidden', 'false');
}

function closeHelpModal() {
    if (helpModal) helpModal.setAttribute('aria-hidden', 'true');
}

helpClose?.addEventListener('click', closeHelpModal);
helpModal?.addEventListener('click', (e) => { if (e.target === helpModal) closeHelpModal(); });

// Tooltip behavior: show on hover, and on long-press for touch devices
let tooltipEl = null;
let longPressTimer = null;

function createTooltip(text) {
    if (tooltipEl) tooltipEl.remove();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'help-tooltip';
    tooltipEl.innerText = text;
    document.body.appendChild(tooltipEl);
}

function positionTooltip(target) {
    if (!tooltipEl) return;
    const rect = target.getBoundingClientRect();
    tooltipEl.style.top = (rect.bottom + window.scrollY + 8) + 'px';
    tooltipEl.style.left = (rect.left + window.scrollX) + 'px';
}

document.querySelectorAll('.help-btn').forEach(btn => {
    const key = btn.dataset.help;
    const info = helpTexts[key];
    if (!info) return;

    btn.addEventListener('mouseenter', (e) => {
        createTooltip(info.short);
        positionTooltip(btn);
    });
    btn.addEventListener('mouseleave', () => { if (tooltipEl) tooltipEl.remove(); tooltipEl = null; clearTimeout(longPressTimer); });

    // touch/long-press support
    btn.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => { createTooltip(info.short); positionTooltip(btn); }, 600);
    }, { passive: true });
    btn.addEventListener('touchend', (e) => { clearTimeout(longPressTimer); if (tooltipEl) tooltipEl.remove(); tooltipEl = null; });

    btn.addEventListener('click', (e) => {
        e.preventDefault();
        showHelpModal(key);
    });
});

// --- Global settings button and dark mode ---
const globalSettingsBtn = document.getElementById('globalSettingsBtn');
const globalSettingsMenu = document.getElementById('globalSettingsMenu');
const darkModeToggle = document.getElementById('darkModeToggle');

function setDarkMode(enabled, persist = true) {
    if (enabled) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    if (persist) storageSet('darkMode', enabled ? '1' : '0');
    if (darkModeToggle) darkModeToggle.checked = !!enabled;
}

globalSettingsBtn?.addEventListener('click', (e) => {
    const isOpen = globalSettingsMenu && globalSettingsMenu.getAttribute('aria-hidden') === 'false';
    if (globalSettingsMenu) globalSettingsMenu.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    if (globalSettingsBtn) globalSettingsBtn.classList.toggle('open', !isOpen);
    if (!isOpen) { globalSettingsBtn.setAttribute('aria-expanded', 'true'); }
    else { globalSettingsBtn.setAttribute('aria-expanded', 'false'); }
});

// dark mode toggle
darkModeToggle?.addEventListener('change', (e) => { setDarkMode(e.target.checked, true); });

// initialize from localStorage
try {
    const pref = storageGet('darkMode');
    if (pref === '1') setDarkMode(true, false);
} catch(e) {}

// ------------------ Trust / Privacy modal logic ------------------
const trustModal = document.getElementById('trustModal');
const trustClose = document.getElementById('trustClose');
const trustCloseAlt = document.getElementById('trustCloseAlt');
const dontShowAgain = document.getElementById('dontShowAgain');
const trustBackdrop = document.querySelector('.trust-backdrop');

function showTrustModalIfNeeded() {
    try {
    const skip = storageGet('dontShowTrustModal');
        if (skip === '1') return;
    } catch(e) {}
    if (!trustModal) return;
    trustModal.setAttribute('aria-hidden', 'false');
    // focus the primary button for keyboard users
    setTimeout(() => { try { trustClose.focus(); } catch(e){} }, 60);
}

function closeTrustModal() {
    if (!trustModal) return;
    if (dontShowAgain && dontShowAgain.checked) {
    try { storageSet('dontShowTrustModal', '1'); } catch(e){}
    }
    trustModal.setAttribute('aria-hidden', 'true');
}

trustClose?.addEventListener('click', closeTrustModal);
trustCloseAlt?.addEventListener('click', closeTrustModal);
trustBackdrop?.addEventListener('click', closeTrustModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trustModal && trustModal.getAttribute('aria-hidden') === 'false') {
        closeTrustModal();
    }
});

// Run on load
try { showTrustModalIfNeeded(); } catch(e) {}

// ------------------ Export PDF ------------------
const exportPdfBtn = document.getElementById('exportPdfBtn');
const pdfModal = document.getElementById('pdfModal');
const pdfBackdrop = document.querySelector('.pdf-backdrop');
const pdfStatus = document.getElementById('pdfStatus');
const pdfProgressFill = document.getElementById('pdfProgressFill');
const pdfPreview = document.getElementById('pdfPreview');
const pdfPreviewFrame = document.getElementById('pdfPreviewFrame');
const pdfCancelBtn = document.getElementById('pdfCancelBtn');
const pdfDownloadBtn = document.getElementById('pdfDownloadBtn');
const pdfCloseBtn = document.getElementById('pdfCloseBtn');

function pdfSetProgress(percent, text) {
    try {
        if (typeof percent === 'number' && pdfProgressFill) pdfProgressFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
        if (pdfStatus && text) pdfStatus.innerText = text;
    } catch(e) {}
}

function pdfResetUi() {
    __pdfState.cancel = false;
    __pdfState.running = false;
    if (pdfDownloadBtn) pdfDownloadBtn.disabled = true;
    if (pdfCancelBtn) pdfCancelBtn.disabled = false;
    if (pdfCloseBtn) pdfCloseBtn.disabled = false;
    if (pdfPreview) pdfPreview.setAttribute('aria-hidden', 'true');
    if (pdfPreviewFrame) pdfPreviewFrame.removeAttribute('src');
    try { if (__pdfState.blobUrl) URL.revokeObjectURL(__pdfState.blobUrl); } catch(e) {}
    __pdfState.blobUrl = null;
    __pdfState.fileName = null;
    pdfSetProgress(0, 'Preparing...');
}

function pdfSetBusyState(isBusy, statusText) {
    try {
        // While busy: allow Cancel, disable Download.
        // While not busy (idle): allow Close, keep Download disabled until we have a blob.
        if (pdfCancelBtn) pdfCancelBtn.disabled = !isBusy;
        if (pdfCloseBtn) pdfCloseBtn.disabled = false;
        if (pdfDownloadBtn) pdfDownloadBtn.disabled = true;
        if (statusText) pdfSetProgress(undefined, statusText);
    } catch(e) {}
}

function pdfSetReadyState() {
    try {
        if (pdfCancelBtn) pdfCancelBtn.disabled = true;
        if (pdfCloseBtn) pdfCloseBtn.disabled = false;
        if (pdfDownloadBtn) pdfDownloadBtn.disabled = false;
    } catch(e) {}
}

function openPdfModal() {
    if (!pdfModal) return;
    pdfModal.setAttribute('aria-hidden', 'false');
}

function closePdfModal() {
    if (!pdfModal) return;
    if (__pdfState.running) {
        __pdfState.cancel = true;
        pdfSetProgress(0, 'Cancelling...');
        return;
    }
    pdfModal.setAttribute('aria-hidden', 'true');
    pdfResetUi();
}

async function yieldToUi() {
    await new Promise(r => setTimeout(r, 0));
}

function extractMessagePlainText(msg) {
    const rawText = msg.text || msg.content || '';
    const text = String(rawText || '').replace(/\s+/g, ' ').trim();
    const timestamp = msg.timestamp || msg.timestamp_ms || 0;
    const sender = msg.senderName || msg.sender_name || 'Unknown';
    return { sender, text, timestamp };
}

async function buildChatPdf(data, selectedPerspective) {
    const jspdfNs = window.jspdf;
    const JsPdfCtor = jspdfNs && jspdfNs.jsPDF;
    if (!JsPdfCtor) throw new Error('jsPDF not loaded');

    const h2c = window.html2canvas;
    if (!h2c) throw new Error('html2canvas not loaded');

    const threadName = data.threadName || data.title || data.threadPath || 'Untitled';
    const messages = Array.isArray(data.messages) ? data.messages : [];

    const chatEl = document.getElementById('chat');
    const chatContainerEl = document.querySelector('.chat-container');

    const chatWidthPx = Math.max(680, Math.min(980, (chatEl && chatEl.clientWidth) ? chatEl.clientWidth : 860));
    const a4Ratio = 297 / 210;

    const pagePaddingPx = 10;
    const pageWidthPx = chatWidthPx;
    const pageHeightPx = Math.round(pageWidthPx * a4Ratio);
    const viewportHeightPx = pageHeightPx;

    const bg = (() => {
        try {
            const c = chatContainerEl ? getComputedStyle(chatContainerEl).backgroundColor : '';
            return c || '#ffffff';
        } catch(e) { return '#ffffff'; }
    })();

    const offscreen = document.createElement('div');
    offscreen.style.position = 'fixed';
    offscreen.style.left = '-10000px';
    offscreen.style.top = '0';
    offscreen.style.width = pageWidthPx + 'px';
    offscreen.style.zIndex = '-1';
    offscreen.style.background = bg;
    offscreen.style.color = 'inherit';

    const content = document.createElement('div');
    content.style.boxSizing = 'border-box';
    content.style.width = '100%';
    content.style.padding = pagePaddingPx + 'px';
    content.style.background = bg;

    const header = document.createElement('div');
    header.style.boxSizing = 'border-box';
    header.style.width = '100%';
    header.style.fontSize = '14px';
    header.style.color = 'rgba(0,0,0,0.55)';
    try {
        const muted = getComputedStyle(document.documentElement).getPropertyValue('--muted');
        if (muted) header.style.color = muted.trim();
    } catch(e) {}
    header.style.marginBottom = '8px';
    header.textContent = `${threadName} — Exported ${new Date().toLocaleString()}`;
    content.appendChild(header);

    const messagesHost = document.createElement('div');
    messagesHost.style.boxSizing = 'border-box';
    messagesHost.style.width = '100%';
    content.appendChild(messagesHost);

    offscreen.appendChild(content);
    document.body.appendChild(offscreen);

    const showMyName = !!document.getElementById('showMyName')?.checked;
    const showTheirName = !!document.getElementById('showTheirName')?.checked;
    const showTime = !!document.getElementById('showTime')?.checked;
    const showReacts = !!document.getElementById('showReacts')?.checked;

    const total = messages.length;
    const BUILD_BATCH = 200;
    pdfSetProgress(0, 'Preparing DOM...');
    await yieldToUi();

    for (let i = 0; i < total; i++) {
        if (__pdfState.cancel) {
            try { offscreen.remove(); } catch(e) {}
            throw new Error('cancelled');
        }

        const msg = messages[i];
        const sender = msg.senderName || msg.sender_name || 'Unknown';
        const fromMe = sender === selectedPerspective;

        const div = document.createElement('div');
        div.classList.add('message', fromMe ? 'from-me' : 'from-them');
        div.innerHTML = createMessageHTML(msg, '');
        messagesHost.appendChild(div);

        // Apply checkbox visibility like in UI
        try {
            if (!showTime) div.querySelectorAll('.timestamp').forEach(el => (el.style.display = 'none'));
            if (!showReacts) div.querySelectorAll('.reaction').forEach(el => (el.style.display = 'none'));
            if (fromMe && !showMyName) div.querySelectorAll('.sender-name').forEach(el => (el.style.display = 'none'));
            if (!fromMe && !showTheirName) div.querySelectorAll('.sender-name').forEach(el => (el.style.display = 'none'));
        } catch(e) {}

        if ((i + 1) % BUILD_BATCH === 0) {
            const p = Math.round(((i + 1) / total) * 30);
            pdfSetProgress(p, `Preparing DOM ${i + 1}/${total}...`);
            await yieldToUi();
        }
    }

    // Ensure layout is fully calculated
    await yieldToUi();

    // Replace audio/video elements with capture-friendly placeholders (html2canvas cannot reliably render media)
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
                img.className = 'preview';
                img.src = poster;
                img.alt = 'Video thumbnail';
                v.replaceWith(img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'placeholder';
                ph.textContent = '[Video]';
                v.replaceWith(ph);
            }
        });
    } catch(e) {}

    // Best-effort: wait briefly for images to load so capture matches UI
    try {
        const imgs = Array.from(messagesHost.querySelectorAll('img'));
        const waits = imgs.map(img => new Promise(resolve => {
            if (img.complete) return resolve();
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
            setTimeout(done, 2500);
        }));
        await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, 2600))]);
    } catch(e) {}

    await yieldToUi();

    const scrollHeight = Math.ceil(content.scrollHeight);

    // Compute page breaks on message boundaries to reduce message splitting across pages.
    const messageEls = Array.from(messagesHost.querySelectorAll('.message'));
    const breaks = [0];
    let startY = 0;
    const maxPages = 500;
    for (let guard = 0; guard < maxPages && startY < scrollHeight - 2; guard++) {
        const limit = startY + viewportHeightPx;
        let best = null;
        for (const el of messageEls) {
            // offsetTop is relative to messagesHost, so include host offset to match content scroll coords
            const top = (messagesHost.offsetTop || 0) + el.offsetTop;
            const bottom = top + el.offsetHeight;
            if (bottom <= limit && top >= startY) {
                best = bottom;
            }
            if (top > limit) break;
        }
        if (best === null || best <= startY + 60) {
            // Fallback: if a single message is taller than a page, allow slicing.
            best = Math.min(limit, scrollHeight);
        }
        if (best >= scrollHeight) {
            breaks.push(scrollHeight);
            break;
        }
        // small gap so next page doesn't start flush at the exact boundary
        const nextStart = Math.min(best, scrollHeight);
        breaks.push(nextStart);
        startY = nextStart;
    }

    const pageCount = Math.max(1, breaks.length - 1);

    const doc = new JsPdfCtor({ unit: 'pt', format: 'a4' });
    const pageWidthPt = doc.internal.pageSize.getWidth();
    const pageHeightPt = doc.internal.pageSize.getHeight();
    const marginPt = 10;
    const targetWidthPt = pageWidthPt - marginPt * 2;
    const targetHeightPt = pageHeightPt - marginPt * 2;

    // Render each page as a slice (pixel-perfect)
    for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
        if (__pdfState.cancel) {
            try { offscreen.remove(); } catch(e) {}
            throw new Error('cancelled');
        }

        const sliceStart = breaks[pageIdx];

        const slice = document.createElement('div');
        slice.style.width = pageWidthPx + 'px';
        slice.style.height = viewportHeightPx + 'px';
        slice.style.overflow = 'hidden';
        slice.style.background = bg;

        const inner = content.cloneNode(true);
        inner.style.transform = `translateY(-${sliceStart}px)`;
        inner.style.transformOrigin = 'top left';
        slice.appendChild(inner);
        offscreen.appendChild(slice);

        const canvas = await h2c(slice, {
            backgroundColor: bg,
            scale: Math.min(2, window.devicePixelRatio || 1),
            useCORS: true,
            logging: false
        });

        try { slice.remove(); } catch(e) {}

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const imgW = targetWidthPt;
        const imgH = Math.min(targetHeightPt, (canvas.height * imgW) / canvas.width);

        if (pageIdx > 0) doc.addPage();
        doc.addImage(imgData, 'JPEG', marginPt, marginPt, imgW, imgH, undefined, 'FAST');

        const p = 30 + Math.round(((pageIdx + 1) / pageCount) * 70);
        pdfSetProgress(p, `Rendering page ${pageIdx + 1}/${pageCount}...`);
        await yieldToUi();
    }

    try { offscreen.remove(); } catch(e) {}

    pdfSetProgress(100, 'Finalizing...');
    await yieldToUi();

    const blob = doc.output('blob');
    const fileName = sanitizeFileName(threadName) + '.pdf';
    return { blob, fileName };
}

async function startPdfExport() {
    if (__pdfState.running) return;
    if (!window.currentChatData || !window.currentChatData.messages) return;

    const total = (window.currentChatData.messages || []).length;
    if (!total) return;

    // Guardrails to reduce crash risk on exact DOM rendering (html2canvas)
    if (total > 12000) {
        alert('This conversation is too large to export in "exact" mode safely. Please narrow down the data and try again.');
        return;
    }
    if (total > 4000) {
        const ok = confirm(`This export will include ${total} messages and may take a long time / use a lot of memory. Continue?`);
        if (!ok) return;
    }

    openPdfModal();
    pdfResetUi();
    __pdfState.running = true;

    try {
        pdfSetBusyState(true, 'Preparing...');
        pdfSetProgress(0, 'Preparing...');
        await yieldToUi();

        const selectedPerspective = getSelectedPerspective();
        const { blob, fileName } = await buildChatPdf(window.currentChatData, selectedPerspective);
        if (__pdfState.cancel) throw new Error('cancelled');

        const url = URL.createObjectURL(blob);
        __pdfState.blobUrl = url;
        __pdfState.fileName = fileName;

        if (pdfPreviewFrame) pdfPreviewFrame.src = url;
        if (pdfPreview) pdfPreview.setAttribute('aria-hidden', 'false');
        pdfSetReadyState();
        pdfSetProgress(100, 'Ready. Preview below.');
    } catch (e) {
        if (String(e && e.message) === 'cancelled') {
            pdfSetProgress(0, 'Cancelled.');
        } else {
            pdfSetProgress(0, 'Failed to export PDF.');
        }
    } finally {
        __pdfState.running = false;
        __pdfState.cancel = false;
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

exportPdfBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    startPdfExport();
});

pdfCancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (__pdfState.running) {
        __pdfState.cancel = true;
        try { if (pdfCancelBtn) pdfCancelBtn.disabled = true; } catch(e) {}
        pdfSetProgress(0, 'Cancelling...');
    }
});

pdfDownloadBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadPdf();
});

pdfCloseBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closePdfModal();
});

pdfBackdrop?.addEventListener('click', (e) => {
    closePdfModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pdfModal && pdfModal.getAttribute('aria-hidden') === 'false') {
        closePdfModal();
    }
});

// ------------------ HTML Archive Export ------------------

const __htmlState = { running: false, cancel: false, blobUrl: null, fileName: null };

const htmlModal = document.getElementById('htmlModal');
const htmlBackdrop = document.querySelector('.html-backdrop');
const htmlCancelBtn = document.getElementById('htmlCancelBtn');
const htmlDownloadBtn = document.getElementById('htmlDownloadBtn');
const htmlCloseBtn = document.getElementById('htmlCloseBtn');
const exportHtmlBtn = document.getElementById('exportHtmlBtn');

function openHtmlModal() {
    if (htmlModal) htmlModal.setAttribute('aria-hidden', 'false');
}

function closeHtmlModal() {
    if (__htmlState.running) {
        __htmlState.cancel = true;
    }
    if (htmlModal) htmlModal.setAttribute('aria-hidden', 'true');
    if (__htmlState.blobUrl) { URL.revokeObjectURL(__htmlState.blobUrl); __htmlState.blobUrl = null; }
    __htmlState.running = false;
    __htmlState.cancel = false;
    if (htmlDownloadBtn) htmlDownloadBtn.disabled = true;
}

function htmlSetProgress(pct, text) {
    const fill = document.getElementById('htmlProgressFill');
    const status = document.getElementById('htmlStatus');
    if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (status) status.textContent = text || '';
}

function htmlSetSize(text) {
    const el = document.getElementById('htmlSizeEstimate');
    if (el) el.textContent = text || '';
}

/** Convert a blob URL to a base64 data URI, optionally compressing images */
async function blobUrlToDataUri(blobUrl, mType, compress) {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();

    if (compress && mType === 'image' && blob.size > 0) {
        try {
            const dataUri = await compressImageBlob(blob);
            if (dataUri) return dataUri;
        } catch (_) { /* fall through to raw base64 */ }
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/** Compress an image blob via canvas — max 800px, JPEG q=0.65 */
const __compressCanvas = { el: null, ctx: null };
function compressImageBlob(blob) {
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            const MAX = 800;
            let { width: w, height: h } = img;
            if (w > MAX || h > MAX) {
                const scale = MAX / Math.max(w, h);
                w = Math.round(w * scale);
                h = Math.round(h * scale);
            }
            if (!__compressCanvas.el) {
                __compressCanvas.el = document.createElement('canvas');
                __compressCanvas.ctx = __compressCanvas.el.getContext('2d');
            }
            __compressCanvas.el.width = w;
            __compressCanvas.el.height = h;
            __compressCanvas.ctx.drawImage(img, 0, 0, w, h);
            const dataUri = __compressCanvas.el.toDataURL('image/jpeg', 0.65);
            URL.revokeObjectURL(url);
            resolve(dataUri);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
    });
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

async function buildHtmlArchive(data, selectedPerspective) {
    const threadName = data.threadName || data.title || data.threadPath || 'Untitled';
    const messages = Array.isArray(data.messages) ? data.messages : [];
    const compressImages = !!document.getElementById('htmlCompressImages')?.checked;
    const includeMedia = !!document.getElementById('htmlIncludeMedia')?.checked;

    const showMyName = !!document.getElementById('showMyName')?.checked;
    const showTheirName = !!document.getElementById('showTheirName')?.checked;
    const showTime = !!document.getElementById('showTime')?.checked;
    const showReacts = !!document.getElementById('showReacts')?.checked;

    // Phase 1: Collect unique media references and convert to data URIs
    const mediaMap = new Map(); // fileName → dataUri
    if (includeMedia) {
        const refs = new Set();
        for (const msg of messages) {
            const items = [].concat(msg.media || [], msg.photos || [], msg.videos || [], msg.audio || [], msg.audio_files || [], msg.gifs || []);
            for (const item of items) {
                if (item?.uri) refs.add(item.uri.split(/[\\\/]/).pop().toLowerCase());
            }
        }

        const refArr = [...refs];
        const total = refArr.length;
        const BATCH = 6;
        for (let i = 0; i < total; i += BATCH) {
            if (__htmlState.cancel) throw new Error('cancelled');
            const batch = refArr.slice(i, Math.min(i + BATCH, total));
            const promises = batch.map(fileName => {
                const matchingFile = findMediaFile(fileName);
                if (!matchingFile || !mediaFiles[matchingFile]) return Promise.resolve(null);
                const mType = mediaTypes[matchingFile] || getMediaType(fileName);
                return blobUrlToDataUri(mediaFiles[matchingFile], mType, compressImages)
                    .then(dataUri => ({ fileName, dataUri }))
                    .catch(() => null);
            });
            const results = await Promise.all(promises);
            for (const result of results) {
                if (result?.dataUri) mediaMap.set(result.fileName, result.dataUri);
            }
            htmlSetProgress(((Math.min(i + BATCH, total)) / total) * 60, `Converting media ${Math.min(i + BATCH, total)}/${total}...`);
            await new Promise(r => setTimeout(r, 0));
        }
    }

    if (__htmlState.cancel) throw new Error('cancelled');
    htmlSetProgress(65, 'Building HTML...');
    await new Promise(r => setTimeout(r, 0));

    // Phase 2: Build message HTML
    const msgParts = [];
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const sender = msg.senderName || msg.sender_name || 'Unknown';
        const fromMe = sender === selectedPerspective;
        const rawText = msg.text || msg.content || '';
        const text = escapeHtml(String(rawText));
        const timestamp = msg.timestamp || msg.timestamp_ms || 0;

        const mediaItems = [].concat(msg.media || [], msg.photos || [], msg.videos || [], msg.audio || [], msg.audio_files || [], msg.gifs || []);
        let mediaHtml = '';
        for (const media of mediaItems) {
            if (!media?.uri) continue;
            const fileName = media.uri.split(/[\\\/]/).pop().toLowerCase();
            const dataUri = mediaMap.get(fileName);
            const ext = fileName.split('.').pop().toLowerCase();
            const mType = ext === 'mp4' ? 'video' : getMediaType(fileName);

            if (!dataUri) {
                mediaHtml += `<span class="media-missing">[Media: ${escapeHtml(fileName)}]</span>`;
                continue;
            }
            if (mType === 'image') {
                mediaHtml += `<img src="${dataUri}" alt="Image" loading="lazy">`;
            } else if (mType === 'video') {
                mediaHtml += `<video controls preload="metadata"><source src="${dataUri}" type="video/mp4"></video>`;
            } else if (mType === 'audio') {
                mediaHtml += `<audio controls preload="metadata"><source src="${dataUri}" type="audio/mpeg"></audio>`;
            }
        }

        const reactionsHtml = (showReacts && msg.reactions?.length)
            ? `<div class="reaction">${msg.reactions.map(r => `${escapeHtml(r.actor)}: ${escapeHtml(r.reaction)}`).join(', ')}</div>`
            : '';

        const senderVisible = fromMe ? showMyName : showTheirName;
        const senderHtml = senderVisible ? `<div class="sender-name">${escapeHtml(sender)}</div>` : '';
        const timeHtml = showTime ? `<div class="timestamp" style="display:block">${new Date(timestamp).toLocaleString()}</div>` : '';

        msgParts.push(`<div class="message ${fromMe ? 'from-me' : 'from-them'}">${senderHtml}<div class="message-content">${text}${mediaHtml}${reactionsHtml}${timeHtml}</div></div>`);

        if (i % 500 === 0 && i > 0) {
            htmlSetProgress(65 + (i / messages.length) * 25, `Rendering message ${i}/${messages.length}...`);
            await new Promise(r => setTimeout(r, 0));
        }
    }

    if (__htmlState.cancel) throw new Error('cancelled');
    htmlSetProgress(92, 'Assembling archive...');
    await new Promise(r => setTimeout(r, 0));

    // Phase 3: Assemble standalone HTML
    const isDark = document.documentElement.classList.contains('dark');
    const html = buildStandaloneHtml(threadName, msgParts.join('\n'), isDark);
    return html;
}

function buildStandaloneHtml(threadName, messagesHtml, isDark) {
    const safeTitle = escapeHtml(threadName);
    const exportDate = new Date().toLocaleString();
    return `<!DOCTYPE html>
<html lang="en"${isDark ? ' class="dark"' : ''}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${safeTitle} — Messenger Export</title>
<style>
:root{--bg:#fff;--panel-bg:#f6f8fb;--text:#111213;--muted:#6b6f76;--accent:#0084ff;--me-bg:#0084ff;--me-text:#fff;--them-bg:#e9eef8;--border:#e6e9ee}
.dark{--bg:#0b1116;--panel-bg:#0f161b;--text:#e6eef8;--muted:#9aa4b2;--accent:#3ea6ff;--me-bg:#1667d6;--me-text:#f7fbff;--them-bg:#0f2a3a;--border:#1b2330}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:0}
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

async function startHtmlExport() {
    const data = window.currentChatData;
    if (!data || !data.messages?.length) {
        alert('No conversation loaded to export.');
        return;
    }

    openHtmlModal();
    __htmlState.cancel = false;
    __htmlState.running = true;
    if (__htmlState.blobUrl) { URL.revokeObjectURL(__htmlState.blobUrl); __htmlState.blobUrl = null; }
    if (htmlDownloadBtn) htmlDownloadBtn.disabled = true;
    if (htmlCancelBtn) htmlCancelBtn.disabled = false;
    htmlSetProgress(0, 'Starting...');
    htmlSetSize('');

    const perspective = getSelectedPerspective();

    try {
        const html = await buildHtmlArchive(data, perspective);
        if (__htmlState.cancel) throw new Error('cancelled');

        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const threadName = data.threadName || data.title || data.threadPath || 'Untitled';
        const safeName = threadName.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 60) || 'conversation';

        __htmlState.blobUrl = url;
        __htmlState.fileName = `${safeName}.html`;
        __htmlState.running = false;

        htmlSetProgress(100, 'Ready to download');
        htmlSetSize(`File size: ${formatBytes(blob.size)}`);
        if (htmlDownloadBtn) htmlDownloadBtn.disabled = false;
        if (htmlCancelBtn) htmlCancelBtn.disabled = true;
    } catch (err) {
        __htmlState.running = false;
        if (err.message === 'cancelled') {
            htmlSetProgress(0, 'Cancelled');
        } else {
            console.error('HTML export error:', err);
            htmlSetProgress(0, 'Error: ' + String(err.message || err));
        }
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

exportHtmlBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    startHtmlExport();
});

htmlCancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (__htmlState.running) {
        __htmlState.cancel = true;
        if (htmlCancelBtn) htmlCancelBtn.disabled = true;
        htmlSetProgress(0, 'Cancelling...');
    }
});

htmlDownloadBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadHtmlArchive();
});

htmlCloseBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    closeHtmlModal();
});

htmlBackdrop?.addEventListener('click', () => closeHtmlModal());

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && htmlModal && htmlModal.getAttribute('aria-hidden') === 'false') {
        closeHtmlModal();
    }
});

// ------------------ Media Gallery ------------------

const mediaGalleryBtn = document.getElementById('mediaGalleryBtn');
const mediaModal = document.getElementById('mediaModal');
const mediaModalClose = document.getElementById('mediaModalClose');
const mediaModalGrid = document.getElementById('mediaModalGrid');
const mediaModalStats = document.getElementById('mediaModalStats');
const mediaLightbox = document.getElementById('mediaLightbox');
const mediaLbMain = document.getElementById('mediaLbMain');
const mediaLbCaption = document.getElementById('mediaLbCaption');

let __galleryItems = [];
let __lbIndex = 0;

mediaGalleryBtn?.addEventListener('click', openMediaGallery);
mediaModalClose?.addEventListener('click', closeMediaModal);
document.querySelector('.media-modal-backdrop')?.addEventListener('click', closeMediaModal);
document.getElementById('mediaLbClose')?.addEventListener('click', closeLightbox);
document.querySelector('.media-lightbox-backdrop')?.addEventListener('click', closeLightbox);
document.getElementById('mediaLbPrev')?.addEventListener('click', () => moveLightbox(-1));
document.getElementById('mediaLbNext')?.addEventListener('click', () => moveLightbox(1));

document.addEventListener('keydown', (e) => {
    if (mediaLightbox && mediaLightbox.getAttribute('aria-hidden') === 'false') {
        if (e.key === 'ArrowLeft') moveLightbox(-1);
        if (e.key === 'ArrowRight') moveLightbox(1);
        if (e.key === 'Escape') { closeLightbox(); return; }
    }
    if (mediaModal && mediaModal.getAttribute('aria-hidden') === 'false' && e.key === 'Escape') {
        closeMediaModal();
    }
});

function collectAllMedia(messages) {
    const items = [];
    messages.forEach(msg => {
        const sender = msg.senderName || msg.sender_name || 'Unknown';
        const timestamp = msg.timestamp || msg.timestamp_ms || 0;
        const mediaItems = [].concat(
            msg.media || [],
            msg.photos || [],
            msg.videos || [],
            msg.audio || [],
            msg.audio_files || [],
            msg.gifs || []
        );
        mediaItems.forEach(media => {
            if (!media || !media.uri) return;
            const fileName = media.uri.split(/[\\\/]/).pop().toLowerCase();
            const matchingFile = findMediaFile(fileName);
            const fileURL = matchingFile ? mediaFiles[matchingFile] : null;
            const extension = fileName.split('.').pop().toLowerCase();
            const mediaType = extension === 'mp4' ? 'video' : (matchingFile ? mediaTypes[matchingFile] : getMediaType(fileName));
            items.push({ fileName, fileURL, mediaType, sender, timestamp });
        });
    });
    return items;
}

const GALLERY_BATCH = 30;
let __galleryRenderedCount = 0;
let __gallerySentinel = null;
let __galleryObserver = null;

function openMediaGallery() {
    if (!window.currentChatData) return;
    const items = collectAllMedia(window.currentChatData.messages || []);
    __galleryItems = items;
    __galleryRenderedCount = 0;

    const found = items.filter(i => i.fileURL).length;
    if (mediaModalStats) {
        mediaModalStats.textContent = `${items.length} item${items.length !== 1 ? 's' : ''} · ${found} available · ${items.length - found} not found`;
    }

    if (__galleryObserver) { __galleryObserver.disconnect(); __galleryObserver = null; }
    __gallerySentinel = null;
    mediaModalGrid.innerHTML = '';

    if (!items.length) {
        mediaModalGrid.innerHTML = '<div style="padding:20px;color:var(--muted)">No media in this conversation.</div>';
        mediaModal.setAttribute('aria-hidden', 'false');
        return;
    }

    // Sentinel sits at the end; when it enters view the next batch is appended
    __gallerySentinel = document.createElement('div');
    __gallerySentinel.style.cssText = 'height:1px; grid-column:1/-1;';
    mediaModalGrid.appendChild(__gallerySentinel);

    __galleryObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) renderGalleryBatch();
    }, { root: mediaModalGrid, rootMargin: '400px' });
    __galleryObserver.observe(__gallerySentinel);

    renderGalleryBatch(); // paint the first screenful immediately
    mediaModal.setAttribute('aria-hidden', 'false');
}

function renderGalleryBatch() {
    const start = __galleryRenderedCount;
    const end = Math.min(start + GALLERY_BATCH, __galleryItems.length);
    if (start >= __galleryItems.length) return;

    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
        frag.appendChild(buildGalleryThumb(__galleryItems[i], i));
    }

    // Insert before sentinel so it stays at the bottom
    if (__gallerySentinel && __gallerySentinel.parentNode) {
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

    if (item.fileURL && item.mediaType === 'image') {
        const img = document.createElement('img');
        img.src = item.fileURL; // direct — only GALLERY_BATCH images decoded at once
        img.alt = item.fileName;
        thumb.appendChild(img);
        thumb.appendChild(buildThumbOverlay(item));
        thumb.addEventListener('click', () => openLightbox(idx));

    } else if (item.fileURL && item.mediaType === 'video') {
        const icon = document.createElement('div');
        icon.className = 'media-thumb-video-icon';
        icon.innerHTML = `<span class="thumb-play">&#9654;</span><span class="thumb-label">${escapeHtml(item.fileName)}</span>`;
        thumb.appendChild(icon);
        thumb.appendChild(buildThumbOverlay(item));
        thumb.addEventListener('click', () => openLightbox(idx));

    } else if (item.fileURL && item.mediaType === 'audio') {
        const inner = document.createElement('div');
        inner.className = 'media-thumb-audio';
        inner.innerHTML = `<span style="font-size:28px">&#127925;</span><span>${escapeHtml(item.fileName)}</span>`;
        thumb.appendChild(inner);
        thumb.addEventListener('click', () => openLightbox(idx));

    } else {
        const inner = document.createElement('div');
        inner.className = 'media-thumb-notfound';
        inner.innerHTML = `<span style="font-size:24px">&#128206;</span><span>${escapeHtml(item.fileName)}</span><span>Not found</span>`;
        thumb.appendChild(inner);
    }

    return thumb;
}

function buildThumbOverlay(item) {
    const overlay = document.createElement('div');
    overlay.className = 'media-thumb-overlay';
    const info = document.createElement('div');
    info.className = 'media-thumb-info';
    info.textContent = `${item.sender}\n${new Date(item.timestamp).toLocaleDateString()}`;
    info.style.whiteSpace = 'pre-line';
    overlay.appendChild(info);
    return overlay;
}

function closeMediaModal() {
    if (mediaModal) mediaModal.setAttribute('aria-hidden', 'true');
    if (__galleryObserver) { __galleryObserver.disconnect(); __galleryObserver = null; }
    if (__gallerySentinel) { __gallerySentinel.remove(); __gallerySentinel = null; }
    __galleryRenderedCount = 0;
}

function openLightbox(idx) {
    __lbIndex = idx;
    renderLightboxItem();
    if (mediaLightbox) mediaLightbox.setAttribute('aria-hidden', 'false');
}

function closeLightbox() {
    if (mediaLightbox) mediaLightbox.setAttribute('aria-hidden', 'true');
    // stop any playing media
    mediaLbMain.querySelectorAll('video, audio').forEach(el => { try { el.pause(); el.currentTime = 0; } catch(e){} });
    mediaLbMain.innerHTML = '';
}

function moveLightbox(dir) {
    // find next item that has a fileURL in the given direction
    let next = __lbIndex + dir;
    while (next >= 0 && next < __galleryItems.length && !__galleryItems[next].fileURL) {
        next += dir;
    }
    if (next >= 0 && next < __galleryItems.length && __galleryItems[next].fileURL) {
        __lbIndex = next;
        renderLightboxItem();
    }
}

function renderLightboxItem() {
    const item = __galleryItems[__lbIndex];
    if (!item) return;

    // stop previous media
    mediaLbMain.querySelectorAll('video, audio').forEach(el => { try { el.pause(); } catch(e){} });
    mediaLbMain.innerHTML = '';

    if (item.mediaType === 'image' && item.fileURL) {
        const img = document.createElement('img');
        img.src = item.fileURL;
        img.alt = item.fileName;
        mediaLbMain.appendChild(img);

    } else if (item.mediaType === 'video' && item.fileURL) {
        const video = document.createElement('video');
        video.src = item.fileURL;
        video.controls = true;
        video.autoplay = true;
        mediaLbMain.appendChild(video);

    } else if (item.mediaType === 'audio' && item.fileURL) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;color:#fff';
        wrap.innerHTML = `<span style="font-size:48px">🎵</span><span style="font-size:13px;opacity:.7">${escapeHtml(item.fileName)}</span>`;
        const audio = document.createElement('audio');
        audio.src = item.fileURL;
        audio.controls = true;
        audio.autoplay = true;
        wrap.appendChild(audio);
        mediaLbMain.appendChild(wrap);
    }

    // update prev/next button visibility
    const hasPrev = __galleryItems.slice(0, __lbIndex).some(i => i.fileURL);
    const hasNext = __galleryItems.slice(__lbIndex + 1).some(i => i.fileURL);
    const prevBtn = document.getElementById('mediaLbPrev');
    const nextBtn = document.getElementById('mediaLbNext');
    if (prevBtn) prevBtn.style.opacity = hasPrev ? '1' : '0.2';
    if (nextBtn) nextBtn.style.opacity = hasNext ? '1' : '0.2';

    const available = __galleryItems.filter(i => i.fileURL).length;
    const position = __galleryItems.slice(0, __lbIndex + 1).filter(i => i.fileURL).length;
    if (mediaLbCaption) {
        mediaLbCaption.textContent = `${item.sender} · ${new Date(item.timestamp).toLocaleString()} · ${position}/${available}`;
    }
}
