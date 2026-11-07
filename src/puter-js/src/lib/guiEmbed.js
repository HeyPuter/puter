/**
 * Puter GUI pages a first-party site can frame, under `/embed/*` on the GUI
 * origin. The server lets only a page one label under that origin frame them.
 */

// After the frame loads, how long to wait for the embed's first message
// before treating it as refused (a CSP that blocks it still fires `load`).
const LOAD_GRACE_MS = 1000;
// How long the embed may take to check the session before the popup is used.
const READY_TIMEOUT_MS = 15_000;
// A session check slower than this shows a loading scrim over the page.
const LOADING_DELAY_MS = 200;

// The loading scrim matches the embed's own, which fades in over it once ready.
const STYLE = `
dialog.puter-feedback-embed::backdrop{background:transparent}
dialog.puter-feedback-embed:focus{outline:none}
.puter-feedback-embed-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .16s ease-in-out}
.puter-feedback-embed.is-loading .puter-feedback-embed-loading{opacity:1;pointer-events:auto}
.puter-feedback-embed.is-loading iframe{visibility:hidden}
.puter-feedback-embed-loading span{width:28px;height:28px;box-sizing:border-box;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:puter-feedback-embed-spin .7s linear infinite}
@keyframes puter-feedback-embed-spin{to{transform:rotate(360deg)}}
@media (prefers-color-scheme:dark){.puter-feedback-embed-loading{background:rgba(0,0,0,.66)}}
@media (prefers-reduced-motion:reduce){.puter-feedback-embed-loading{transition:none}.puter-feedback-embed-loading span{animation-duration:1.6s}}
`;

/**
 * Whether a page at `pageUrl` may frame an embed served by `guiOrigin`:
 * exactly one label under its host, on the same scheme and port.
 *
 * @param {string | undefined} pageUrl
 * @param {string} guiOrigin
 * @returns {boolean}
 */
export const canFrameGuiEmbed = (pageUrl, guiOrigin) => {
    let page;
    let gui;
    try {
        page = new URL(pageUrl);
        gui = new URL(guiOrigin);
    } catch {
        return false;
    }
    const host = page.hostname.replace(/\.$/, '').toLowerCase();
    const suffix = `.${gui.hostname.toLowerCase()}`;
    if ( page.protocol !== gui.protocol || page.port !== gui.port || !host.endsWith(suffix) ) return false;
    const label = host.slice(0, -suffix.length);
    return label.length > 0 && !label.includes('.');
};

/**
 * Shows the app feedback dialog from `/embed/feedback` in a modal frame over
 * the page, as the user named, behind a loading scrim while a slow session
 * check runs. Resolves `{ sent }` once the dialog closes or the user cancels
 * the loading scrim, or null when the embed can't serve this user (no
 * matching Puter session, an email to confirm, or a refused frame), so the
 * caller can use the popup instead. Never rejects.
 *
 * @param {Object} opts
 * @param {string} opts.guiOrigin
 * @param {string} opts.userUuid - the page's signed-in user
 * @returns {Promise<{ sent: boolean } | null>}
 */
export const showFeedbackEmbed = ({ guiOrigin, userUuid }) => new Promise((resolve) => {
    let origin;
    try {
        origin = new URL(guiOrigin).origin;
    } catch {
        resolve(null);
        return;
    }
    const url = new URL('/embed/feedback', origin);
    url.hash = new URLSearchParams({ user: userUuid }).toString();

    const dialog = document.createElement('dialog');
    dialog.className = 'puter-feedback-embed';
    dialog.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:hidden;';
    const style = document.createElement('style');
    style.textContent = STYLE;
    const frame = document.createElement('iframe');
    frame.title = 'Send feedback';
    // The embed allows a framing page it can name from the referrer.
    frame.setAttribute('referrerpolicy', 'origin');
    // A frame whose color-scheme differs from its document's is painted
    // opaque, so this matches the embed's. WebKit also gives the frame this
    // scheme as its preferred one, so it has to follow the OS.
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:light dark;';
    const loading = document.createElement('div');
    loading.className = 'puter-feedback-embed-loading';
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', 'Loading');
    loading.append(document.createElement('span'));
    dialog.append(style, frame, loading);

    let settled = false;
    let heard = false;
    let shown = false;
    let ready = false;
    let timer = null;
    let loadingTimer = null;
    const restoreFocus = document.activeElement;
    const wait = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(null), ms);
    };
    const finish = (result) => {
        if ( settled ) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(loadingTimer);
        window.removeEventListener('message', onMessage);
        dialog.remove();
        if ( shown ) restoreFocus?.focus?.({ preventScroll: true });
        resolve(result);
    };
    const show = () => {
        if ( dialog.open ) return;
        shown = true;
        dialog.showModal();
    };
    const onMessage = (event) => {
        if ( event.origin !== origin || event.source !== frame.contentWindow ) return;
        const { msg, state, sent } = event.data ?? {};
        if ( msg === 'feedbackDialogClosed' ) {
            finish({ sent: sent === true });
        } else if ( msg === 'feedbackEmbed' && state === 'loading' ) {
            heard = true;
            wait(READY_TIMEOUT_MS);
        } else if ( msg === 'feedbackEmbed' && state === 'ready' ) {
            heard = true;
            ready = true;
            clearTimeout(timer);
            clearTimeout(loadingTimer);
            dialog.classList.remove('is-loading');
            show();
            frame.focus();
        } else if ( msg === 'feedbackEmbed' && state === 'unavailable' ) {
            finish(null);
        }
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
        if ( ! heard ) wait(LOAD_GRACE_MS);
    });
    // Once ready, Escape outside the frame would close the dialog with the
    // embed's dialog still open inside it; the embed owns dismissal.
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if ( ready ) frame.focus();
        else finish({ sent: false });
    });
    loading.addEventListener('click', () => {
        if ( ! ready ) finish({ sent: false });
    });

    try {
        frame.src = url.href;
        // Hidden at first, so a quickly refused session shows nothing.
        document.body.append(dialog);
        wait(READY_TIMEOUT_MS);
        loadingTimer = setTimeout(() => {
            dialog.classList.add('is-loading');
            show();
        }, LOADING_DELAY_MS);
    } catch {
        finish(null);
    }
});
