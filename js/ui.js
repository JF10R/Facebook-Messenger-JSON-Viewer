// ─────────────────────────────────────────────
// ui.js — dark mode, settings menu, trust modal
// ─────────────────────────────────────────────

// ── dark mode ──

const darkModeToggle    = document.getElementById('darkModeToggle');
const globalSettingsBtn = document.getElementById('globalSettingsBtn');
const globalSettingsMenu = document.getElementById('globalSettingsMenu');

function setDarkMode(enabled, persist = true) {
    document.documentElement.classList.toggle('dark', !!enabled);
    if (persist) storageSet('darkMode', enabled ? '1' : '0');
    if (darkModeToggle) darkModeToggle.checked = !!enabled;
}

darkModeToggle?.addEventListener('change', (e) => setDarkMode(e.target.checked, true));

try {
    if (storageGet('darkMode') === '1') setDarkMode(true, false);
} catch (e) {}

// ── global settings button ──

globalSettingsBtn?.addEventListener('click', () => {
    const isOpen = globalSettingsMenu?.getAttribute('aria-hidden') === 'false';
    globalSettingsMenu?.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
    globalSettingsBtn.classList.toggle('open', !isOpen);
    globalSettingsBtn.setAttribute('aria-expanded', String(!isOpen));
});

// ── trust / privacy modal ──

const trustModal   = document.getElementById('trustModal');
const trustClose   = document.getElementById('trustClose');
const trustCloseAlt = document.getElementById('trustCloseAlt');
const dontShowAgain = document.getElementById('dontShowAgain');
const trustBackdrop = document.querySelector('.trust-backdrop');

function showTrustModalIfNeeded() {
    try { if (storageGet('dontShowTrustModal') === '1') return; } catch (e) {}
    if (!trustModal) return;
    trustModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => { try { trustClose.focus(); } catch (e) {} }, 60);
}

function closeTrustModal() {
    if (!trustModal) return;
    if (dontShowAgain?.checked) try { storageSet('dontShowTrustModal', '1'); } catch (e) {}
    trustModal.setAttribute('aria-hidden', 'true');
}

trustClose?.addEventListener('click', closeTrustModal);
trustCloseAlt?.addEventListener('click', closeTrustModal);
trustBackdrop?.addEventListener('click', closeTrustModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trustModal?.getAttribute('aria-hidden') === 'false') closeTrustModal();
});

// ── init ──
try { showTrustModalIfNeeded(); } catch (e) {}
