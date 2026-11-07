/**
 * Puter GUI pages a first-party site can frame, under `/embed/*` on the GUI
 * origin. The server lets only a page one label under that origin frame them.
 */

// After the frame loads, how long to wait for the embed's first message
// before treating it as refused (a CSP that blocks it still fires `load`).
const LOAD_GRACE_MS = 1000;
// How long the embed may take to check the session before the popup is used.
const READY_TIMEOUT_MS = 15_000;

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
 * the page, as the user named. Resolves `{ sent }` once the dialog closes, or
 * null without showing anything when the embed can't serve this user (no
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
    // The embed draws its own scrim.
    const style = document.createElement('style');
    style.textContent = 'dialog.puter-feedback-embed::backdrop{background:transparent}';
    const frame = document.createElement('iframe');
    frame.title = 'Send feedback';
    // The embed allows a framing page it can name from the referrer.
    frame.setAttribute('referrerpolicy', 'origin');
    // A frame whose color-scheme differs from its document's is painted
    // opaque; the embed declares none.
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal;';
    dialog.append(style, frame);

    let settled = false;
    let heard = false;
    let shown = false;
    let timer = null;
    const restoreFocus = document.activeElement;
    const wait = (ms) => {
        clearTimeout(timer);
        timer = setTimeout(() => finish(null), ms);
    };
    const finish = (result) => {
        if ( settled ) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        dialog.remove();
        if ( shown ) restoreFocus?.focus?.({ preventScroll: true });
        resolve(result);
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
            clearTimeout(timer);
            shown = true;
            dialog.showModal();
            frame.focus();
        } else if ( msg === 'feedbackEmbed' && state === 'unavailable' ) {
            finish(null);
        }
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
        if ( ! heard ) wait(LOAD_GRACE_MS);
    });
    // Escape outside the frame would close the dialog with the embed's
    // dialog still open inside it; the embed owns dismissal.
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        frame.focus();
    });

    try {
        frame.src = url.href;
        // Hidden until the embed is ready, so a refused session shows nothing.
        document.body.append(dialog);
        wait(READY_TIMEOUT_MS);
    } catch {
        finish(null);
    }
});
