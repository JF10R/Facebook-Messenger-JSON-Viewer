// ─────────────────────────────────────────────
// media.js — media file state and helpers
// ─────────────────────────────────────────────

let mediaFiles = {};
let mediaTypes = {};
let __mediaLookupCache = null;
// Gallery cache — invalidated on resetMedia()
let __mediaItemsCache = null;
let __mediaItemsCacheKey = null;

function getMediaType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'aac'].includes(ext)) return 'audio';
    return 'unknown';
}

/** Flatten all media arrays from a message into one list */
function getMessageMedia(msg) {
    return [msg.media, msg.photos, msg.videos, msg.audio, msg.audio_files, msg.gifs].flat().filter(Boolean);
}

/** O(1) lookup: lowercased filename → full key in mediaFiles */
function getMediaLookupMap() {
    if (__mediaLookupCache) return __mediaLookupCache;
    __mediaLookupCache = new Map();
    for (const key of Object.keys(mediaFiles)) {
        __mediaLookupCache.set(key.toLowerCase().split(/[\\\/]/).pop(), key);
    }
    return __mediaLookupCache;
}

function findMediaFile(fileName) {
    return getMediaLookupMap().get(fileName.toLowerCase()) || null;
}

/** Resolve media type; mp4 always maps to video regardless of stored type */
function resolveMediaType(ext, matchingFile) {
    if (ext === 'mp4') return 'video';
    return matchingFile ? mediaTypes[matchingFile] : getMediaType('x.' + ext);
}

function resetMedia() {
    Object.values(mediaFiles).forEach(url => URL.revokeObjectURL(url));
    mediaFiles = {};
    mediaTypes = {};
    __mediaLookupCache = null;
    __mediaItemsCache = null;
    __mediaItemsCacheKey = null;
}

async function processMediaFiles(files) {
    const BATCH_SIZE = 20;
    const fileArray = Array.from(files);
    resetMedia();
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
        await Promise.all(fileArray.slice(i, i + BATCH_SIZE).map(file => {
            const url = URL.createObjectURL(file);
            const path = file.webkitRelativePath || file.name;
            mediaFiles[path] = url;
            mediaTypes[path] = getMediaType(file.name);
        }));
    }
    console.log('Media files processed:', Object.keys(mediaFiles).length);
}

// ── folder input (single-JSON workflow) ──
document.getElementById('mediaFolder').addEventListener('change', function (event) {
    const files = event.target.files;
    if (!files.length) return;

    const chatContainer = document.getElementById('chat');
    const loading = document.getElementById('loading');
    chatContainer.style.display = 'none';
    loading.innerHTML = 'Processing media...';
    loading.style.display = 'flex';

    processMediaFiles(files).then(() => {
        if (window.currentChatData) {
            renderMessages(window.currentChatData, document.querySelector('input[name="choice"]:checked').value);
            loading.style.display = 'none';
            chatContainer.style.display = 'block';
        }
    });
});
