// ─────────────────────────────────────────────
// storage.js — localStorage with cookie fallback
// ─────────────────────────────────────────────

const STORAGE_PREFIX = 'fmjv_' + (window.location.hostname || 'local') + '_';

function setCookie(name, value, days = 365) {
    try {
        const expires = new Date(Date.now() + days * 864e5).toUTCString();
        document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/';
    } catch (e) {}
}

function getCookie(name) {
    try {
        for (const c of (document.cookie || '').split('; ')) {
            const [k, v] = c.split('=');
            if (decodeURIComponent(k) === name) return decodeURIComponent(v || '');
        }
    } catch (e) {}
    return null;
}

function storageSet(key, value) {
    const k = STORAGE_PREFIX + key;
    try { localStorage.setItem(k, String(value)); return; } catch (e) {}
    try { setCookie(k, String(value)); } catch (e) {}
}

function storageGet(key) {
    const k = STORAGE_PREFIX + key;
    try { const v = localStorage.getItem(k); if (v !== null) return v; } catch (e) {}
    try { const v = getCookie(k); if (v !== null) return v; } catch (e) {}
    return null;
}

function storageRemove(key) {
    const k = STORAGE_PREFIX + key;
    try { localStorage.removeItem(k); } catch (e) {}
    try { setCookie(k, '', -1); } catch (e) {}
}
