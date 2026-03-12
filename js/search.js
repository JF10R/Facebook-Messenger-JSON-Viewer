// ─────────────────────────────────────────────
// search.js — in-conversation search
// ─────────────────────────────────────────────

const searchInput    = document.getElementById('searchInput');
const searchBtn      = document.getElementById('searchBtn');
const searchResultsEl = document.getElementById('searchResults');
const searchProgress  = document.getElementById('searchProgress');

if (searchResultsEl) searchResultsEl.style.display = 'none';

let __searchIndex = null;
let _highlightTimeout = null;

// ── event listeners ──
searchBtn?.addEventListener('click', startSearch);
searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') startSearch(); });
document.getElementById('clearSearchBtn')?.addEventListener('click', clearSearch);

searchInput?.addEventListener('input', () => {
    clearTimeout(_highlightTimeout);
    _highlightTimeout = setTimeout(() => {
        const q = (searchInput.value || '').trim();
        if (!q && searchResultsEl) searchResultsEl.style.display = 'none';
        updateHighlightsAcrossDOM(q);
    }, 250);
});

// ── highlight helpers ──

function buildNormalizedMap(original) {
    const mapping = [];
    let normalized = '';
    for (let i = 0; i < original.length; i++) {
        const n = original[i].normalize('NFD').replace(/\p{Diacritic}/gu, '');
        for (let k = 0; k < n.length; k++) { mapping.push(i); normalized += n[k]; }
    }
    return { normalized: normalized.toLowerCase(), mapping };
}

function findRangesForToken(original, tokenNorm, prebuiltMap) {
    const { normalized, mapping } = prebuiltMap || buildNormalizedMap(original);
    const ranges = [];
    let start = 0;
    while (true) {
        const idx = normalized.indexOf(tokenNorm, start);
        if (idx === -1) break;
        ranges.push([mapping[idx], mapping[idx + tokenNorm.length - 1] + 1]);
        start = idx + tokenNorm.length;
    }
    return ranges;
}

function mergeRanges(ranges) {
    if (!ranges.length) return [];
    ranges.sort((a, b) => a[0] - b[0]);
    const out = [ranges[0].slice()];
    for (let i = 1; i < ranges.length; i++) {
        const last = out[out.length - 1];
        if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
        else out.push(ranges[i].slice());
    }
    return out;
}

function highlightText(original, query) {
    if (!query || !original) return escapeHtml(original);
    const tokens = normalizeForSearch(query).split(' ').filter(Boolean);
    if (!tokens.length) return escapeHtml(original);

    const normalizedMap = buildNormalizedMap(original);
    const allRanges = tokens.flatMap(t => findRangesForToken(original, t, normalizedMap));
    if (!allRanges.length) return escapeHtml(original);

    let out = '';
    let lastIdx = 0;
    for (const [s, e] of mergeRanges(allRanges)) {
        out += escapeHtml(original.slice(lastIdx, s));
        out += '<strong>' + escapeHtml(original.slice(s, e)) + '</strong>';
        lastIdx = e;
    }
    return out + escapeHtml(original.slice(lastIdx));
}

// ── search index ──

function buildSearchIndex(messages) {
    return messages.map((m, i) => {
        const parts = [];
        const msgText = getMessageText(m);
        if (msgText) parts.push(msgText);
        const sender = getSenderName(m);
        parts.push(sender);
        if (m.reactions?.length) parts.push(m.reactions.map(r => r.reaction + ' ' + (r.actor || '')).join(' '));
        getMessageMedia(m).forEach(mi => { if (mi?.uri) parts.push(mi.uri); });
        const text = parts.join(' ');
        return { text, normalized: normalizeForSearch(text), sender, timestamp: m.timestamp || m.timestamp_ms || 0, idx: i };
    });
}

function fuzzyScore(query, target) {
    if (!query || !target) return 0;
    if (target.includes(query)) return 100 + Math.min(50, query.length);

    const qTokens = query.split(' ');
    const tTokens = target.split(' ');
    let overlap = 0;
    for (const qt of qTokens) {
        for (const tt of tTokens) {
            if (tt.includes(qt) || qt.includes(tt)) { overlap++; break; }
        }
    }

    function lev(a, b) {
        const m = a.length, n = b.length;
        if (m * n === 0) return m + n;
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) {
            const cur = [i];
            for (let j = 1; j <= n; j++) {
                cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + 1);
            }
            prev = cur;
        }
        return prev[n];
    }

    const shortQuery = query.slice(0, 30);
    return overlap * 10 + Math.max(0, 30 - lev(shortQuery, target.slice(0, shortQuery.length + 10)));
}

async function performSearch(query, index, onProgress) {
    const results = [];
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) return results;

    const BATCH = 500;
    for (let i = 0; i < index.length; i += BATCH) {
        for (const item of index.slice(i, i + BATCH)) {
            const score = fuzzyScore(normalizedQuery, item.normalized);
            if (score > 0) results.push({ score, item });
        }
        if (onProgress) onProgress(Math.min(100, Math.round(((i + BATCH) / index.length) * 100)));
        await yieldToUi();
    }
    results.sort((a, b) => b.score - a.score);
    return results;
}

// ── search UI ──

async function startSearch() {
    const q = searchInput.value || '';
    if (!window.currentChatData?.messages) return;

    if (!__searchIndex) {
        searchProgress.style.display = 'flex';
        searchProgress.querySelector('.progress-text').innerText = 'Indexing...';
        await yieldToUi();
        __searchIndex = buildSearchIndex(window.currentChatData.messages);
    }

    searchProgress.style.display = 'flex';
    searchProgress.querySelector('.fill').style.width = '0%';
    searchProgress.querySelector('.progress-text').innerText = 'Searching...';
    searchResultsEl.innerHTML = '';
    if (searchResultsEl) searchResultsEl.style.display = 'block';

    const results = await performSearch(q, __searchIndex, (p) => {
        searchProgress.querySelector('.fill').style.width = p + '%';
        searchProgress.querySelector('.progress-text').innerText = `Searching ${p}%`;
    });

    searchProgress.querySelector('.fill').style.width = '100%';
    searchProgress.querySelector('.progress-text').innerText = `Found ${results.length} matches`;
    setTimeout(() => { searchProgress.style.display = 'none'; }, 800);

    if (!results.length) {
        searchResultsEl.innerHTML = '<div class="search-result-item">No results</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    for (let i = 0; i < Math.min(50, results.length); i++) {
        const r = results[i];
        const el = document.createElement('div');
        el.className = 'search-result-item';
        el.dataset.idx = r.item.idx;
        const originalMsg = window.currentChatData.messages[r.item.idx] || null;
        const rawText = originalMsg ? (originalMsg.text || originalMsg.content || '') : (r.item.text || '');
        el.innerHTML = `<div class="snippet">${highlightText(String(rawText).slice(0, 240), q)}</div><div class="meta">${escapeHtml(r.item.sender)} • ${new Date(r.item.timestamp).toLocaleString()}</div>`;
        el.addEventListener('click', () => jumpToMessage(r.item.idx));
        frag.appendChild(el);
    }
    searchResultsEl.appendChild(frag);
    updateHighlightsAcrossDOM(q);
}

function clearSearch() {
    if (searchInput) searchInput.value = '';
    if (searchResultsEl) { searchResultsEl.innerHTML = ''; searchResultsEl.style.display = 'none'; }
    if (searchProgress) {
        searchProgress.querySelector('.fill').style.width = '0%';
        searchProgress.querySelector('.progress-text').innerText = 'Idle';
        searchProgress.style.display = 'none';
    }
    updateHighlightsAcrossDOM('');
}

// ── jump to message ──

async function jumpToMessage(messageIndex) {
    const chunkIndex = Math.floor(messageIndex / CHUNK_SIZE);
    const chunkContainer = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);

    if (chunkContainer && !renderedMessages.has(chunkIndex)) {
        const msgs = window.currentChatData.messages.slice(chunkIndex * CHUNK_SIZE, chunkIndex * CHUNK_SIZE + CHUNK_SIZE);
        renderChunk(chunkIndex, msgs, document.querySelector('input[name="choice"]:checked').value);
    }

    await new Promise(r => setTimeout(r, 20));

    const msgEl = document.querySelector(`.message[data-msg-index="${messageIndex}"]`);
    if (!msgEl) {
        const chunk = document.querySelector(`.message-chunk[data-chunk-index="${chunkIndex}"]`);
        if (chunk) {
            const localIdx = messageIndex - chunkIndex * CHUNK_SIZE;
            const candidate = chunk.querySelectorAll('.message')[localIdx] || null;
            if (candidate) { await scrollAndHighlight(candidate); }
        }
        return;
    }
    await scrollAndHighlight(msgEl);
}

function scrollIntoViewWithPadding(container, element, padding = 60) {
    const offset = (element.getBoundingClientRect().top - container.getBoundingClientRect().top) - padding;
    container.scrollTop += offset;
}

async function scrollAndHighlight(el) {
    scrollIntoViewWithPadding(document.getElementById('chat'), el, 120);
    el.classList.add('highlight-target', 'temporary-highlight');
    setTimeout(() => el.classList.remove('temporary-highlight'), 2200);
    await new Promise(r => setTimeout(r, 300));
}

// ── live highlight across rendered DOM ──

function updateHighlightsAcrossDOM(query) {
    document.querySelectorAll('.message').forEach(el => {
        const contentEl = el.querySelector('.message-content');
        if (!contentEl) return;

        // Extract plain text from the content node (strip existing <strong> tags)
        const clone = contentEl.cloneNode(true);
        clone.querySelectorAll('.media-preview, audio, .preview, .reaction, .timestamp').forEach(n => n.remove());
        clone.querySelectorAll('strong').forEach(s => s.replaceWith(document.createTextNode(s.textContent)));
        const plain = clone.textContent || '';

        // Re-collect media/reaction/timestamp HTML from original
        const seen = new Set();
        const extras = [];
        contentEl.querySelectorAll('.media-preview, audio, .reaction, .timestamp').forEach(n => {
            const html = n.outerHTML;
            if (!seen.has(html)) { seen.add(html); extras.push(html); }
        });

        contentEl.innerHTML = highlightText(plain, query) + extras.join('');
    });
}
