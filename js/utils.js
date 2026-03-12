// ─────────────────────────────────────────────
// utils.js — pure helpers, no DOM or state deps
// ─────────────────────────────────────────────

function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function sanitizeFileName(name) {
    return String(name || 'conversation')
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 140) || 'conversation';
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
}

function chunkArray(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) result.push(array.slice(i, i + size));
    return result;
}

function formatConvDate(timestamp) {
    const date = new Date(timestamp);
    const diffDays = Math.floor((Date.now() - date) / 86400000);
    if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function normalizeForSearch(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Parse a Messenger JSON string, handling the legacy thread_path encoding.
 * Returns { data, isThreadPath } — callers must reverse data.messages if isThreadPath.
 */
function decodeMessengerJson(text) {
    if (!text.includes('"thread_path"')) {
        return { data: JSON.parse(text), isThreadPath: false };
    }
    const replaced = text.replace(/\\u00([a-f0-9]{2})|\\u([a-f0-9]{4})/gi, (m, p1, p2) =>
        String.fromCharCode(p1 ? parseInt(p1, 16) : parseInt(p2, 16)));
    return { data: JSON.parse(decodeURIComponent(escape(replaced))), isThreadPath: true };
}

/** Extract lowercased filename + extension from a media URI */
function parseMediaFileName(uri) {
    const fileName = uri.split(/[\\\/]/).pop().toLowerCase();
    const ext = fileName.split('.').pop().toLowerCase();
    return { fileName, ext };
}

/** Normalised sender name from either message format */
function getSenderName(msg) {
    return msg.senderName || msg.sender_name || 'Unknown';
}

/** Normalised text content from either message format */
function getMessageText(msg) {
    return String(msg.text || msg.content || '');
}

async function yieldToUi() {
    await new Promise(r => setTimeout(r, 0));
}
