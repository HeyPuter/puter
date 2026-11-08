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

// The loading scrim matches the feedback embed's own, which fades in over it
// once ready. A popup frame keeps it as the scrim behind its box. Scrolling
// over the dialog stays there rather than scrolling the page behind it.
const embedStyle = (cls) => `
dialog.${cls}{overscroll-behavior:contain}
dialog.${cls}::backdrop{background:transparent}
dialog.${cls}:focus{outline:none}
.${cls}-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .16s ease-in-out}
.${cls}.is-loading .${cls}-loading{opacity:1;pointer-events:auto}
.${cls}.is-loading iframe{visibility:hidden}
.${cls}-loading span{width:28px;height:28px;box-sizing:border-box;border:3px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:${cls}-spin .7s linear infinite}
@keyframes ${cls}-spin{to{transform:rotate(360deg)}}
@media (prefers-color-scheme:dark){.${cls}-loading{background:rgba(0,0,0,.66)}}
@media (prefers-reduced-motion:reduce){.${cls}-loading{transition:none}.${cls}-loading span{animation-duration:1.6s}}
`;

// A popup frame sits in a box the size of the popup window it replaces, over
// the scrim, and fills the screen on a phone as the popup's tab would. Its
// white backing stops 1px inside the rounded edge, so in dark mode it doesn't
// show as a light fringe around the frame. The close button starts from
// `all:unset` so the page's own button styles don't reach it.
const BOX_STYLE = `
.puter-popup-frame .puter-popup-frame-loading{opacity:1;pointer-events:auto}
.puter-popup-frame:not(.is-loading) .puter-popup-frame-loading span{display:none}
.puter-popup-frame.is-loading .puter-popup-frame-box{visibility:hidden}
.puter-popup-frame-box{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);box-sizing:border-box;width:min(var(--puter-popup-frame-width),calc(100% - 32px));height:min(var(--puter-popup-frame-height),calc(100% - 32px));border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.35)}
.puter-popup-frame-box::before{content:"";position:absolute;inset:1px;z-index:-1;border-radius:11px;background:#fff}
.puter-popup-frame-close{all:unset;box-sizing:border-box;position:absolute;top:10px;right:10px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:50%;background:transparent;color:#6b7280;cursor:pointer}
.puter-popup-frame-close:hover{background:rgba(127,127,127,.15)}
.puter-popup-frame-close:focus-visible{outline:2px solid #3b82f6;outline-offset:1px}
.puter-popup-frame-close svg{width:16px;height:16px}
@media (prefers-color-scheme:dark){.puter-popup-frame-close{color:#9ca3af}}
@media (max-width:600px){.puter-popup-frame-box{width:100%;height:100%;border-radius:0}.puter-popup-frame-box::before{inset:0;border-radius:0}}
.puter-popup-frame[open] .puter-popup-frame-loading,.puter-popup-frame:not(.is-loading) .puter-popup-frame-box{animation:puter-popup-frame-in .16s ease-out}
@keyframes puter-popup-frame-in{from{opacity:0}}
@media (prefers-reduced-motion:reduce){.puter-popup-frame[open] .puter-popup-frame-loading,.puter-popup-frame:not(.is-loading) .puter-popup-frame-box{animation:none}}
`;

const CLOSE_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';

// Subdomains the server answers or reserves itself, which it never lets frame
// an embed (the backend's `isReservedSubdomain`). Framing from one would wait
// on a refused frame before falling back.
const RESERVED_LABELS = new Set(['www', 'api', 'js', 'dav', 'about', 'developer', 'docs', 'apps', 'puter-app-icons']);

/**
 * Whether a page at `pageUrl` may frame an embed served by `guiOrigin`:
 * exactly one label under its host, on the same scheme and port, and not one
 * of the GUI's reserved subdomains.
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
    return label.length > 0 && !label.includes('.') && !RESERVED_LABELS.has(label);
};

/**
 * Whether every frame above `win` may frame an embed too. The server's
 * frame-ancestors allows only the GUI and the page, so in a frame of any other
 * site the embed is refused, and opening the popup straight away is faster.
 *
 * @param {Window} win - the page
 * @param {string} guiOrigin
 * @returns {boolean}
 */
export const ancestorsAllowGuiEmbed = (win, guiOrigin) => {
    let gui;
    try {
        gui = new URL(guiOrigin).origin;
    } catch {
        return false;
    }
    const page = win.location.origin;
    const ancestors = win.location.ancestorOrigins;
    if ( ancestors ) return Array.from(ancestors).every((origin) => origin === page || origin === gui);
    // Without ancestorOrigins (Firefox), only a same-origin ancestor can be named.
    try {
        for ( let w = win; w.parent !== w; w = w.parent ) {
            if ( w.parent.location.origin !== page ) return false;
        }
        return true;
    } catch {
        return false;
    }
};

/**
 * Mounts `/embed/<path>` in a modal frame, hidden until the embed reports
 * `ready` and behind a loading scrim once its start takes longer than
 * LOADING_DELAY_MS. Resolves what `onMessage` finishes with, what `dismissed`
 * returns when the user cancels, or null when the frame is refused, never
 * answers, or reports itself unavailable. Never rejects.
 *
 * @template T
 * @param {Object} opts
 * @param {string} opts.guiOrigin
 * @param {string} opts.path - under the GUI origin, such as `/embed/feedback`
 * @param {Record<string, string>} opts.fragment - what the embed reads from its fragment
 * @param {string} opts.className - the dialog's class, prefixing its parts'
 * @param {string} opts.title - the frame's accessible name
 * @param {string} opts.stateMsg - `msg` of the embed's loading, ready and unavailable messages
 * @param {{ width: number, height: number }} [opts.box] - shows the frame in a box this size over a scrim; without it the frame covers the page and the embed draws its own scrim
 * @param {string} [opts.closeLabel] - puts a close button on the box, which dismisses it
 * @param {string} [opts.allow] - the frame's permissions policy, for features the embed uses
 * @param {boolean} [opts.escapeDismisses] - Escape on the page dismisses a ready embed too, instead of handing it the keys
 * @param {() => T} opts.dismissed - the result of a dismissal: Escape or a click on the loading scrim, or the close button
 * @param {(data: Record<string, unknown>, finish: (result: T | null) => void) => void} opts.onMessage - every other message from the embed
 * @param {(frame: Window) => void} [opts.onFrame] - the frame's window, once it exists
 * @returns {Promise<T | null>}
 */
const mountGuiEmbed = ({ guiOrigin, path, fragment, className, title, stateMsg, box, closeLabel, allow, escapeDismisses = false, dismissed, onMessage, onFrame }) => new Promise((resolve) => {
    let origin;
    try {
        origin = new URL(guiOrigin).origin;
    } catch {
        resolve(null);
        return;
    }
    const url = new URL(path, origin);
    url.hash = new URLSearchParams(fragment).toString();

    const dialog = document.createElement('dialog');
    dialog.className = className;
    dialog.setAttribute('aria-label', title);
    // Inline, so the page's own `dialog` and `iframe` styles can't move,
    // round or shrink them.
    dialog.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;min-width:0;min-height:0;max-width:none;max-height:none;margin:0;padding:0;border:0;border-radius:0;box-shadow:none;transform:none;background:transparent;overflow:hidden;';
    const style = document.createElement('style');
    style.textContent = embedStyle(className) + (box ? BOX_STYLE : '');
    const frame = document.createElement('iframe');
    frame.title = title;
    // The embed allows a framing page it can name from the referrer.
    frame.setAttribute('referrerpolicy', 'origin');
    if ( allow ) frame.setAttribute('allow', allow);
    const frameBase = 'display:block;width:100%;height:100%;min-width:0;min-height:0;max-width:none;max-height:none;margin:0;padding:0;border:0;';
    // A frame whose color-scheme differs from its document's is painted
    // opaque, so this matches the embed's. WebKit also gives the frame this
    // scheme as its preferred one, so it has to follow the OS.
    frame.style.cssText = box
        ? frameBase
        : `${frameBase}background:transparent;color-scheme:light dark;`;
    const loading = document.createElement('div');
    loading.className = `${className}-loading`;
    loading.setAttribute('role', 'status');
    loading.setAttribute('aria-label', 'Loading');
    loading.setAttribute('aria-hidden', 'true');
    loading.append(document.createElement('span'));
    dialog.append(style, loading);
    if ( box ) {
        const container = document.createElement('div');
        container.className = `${className}-box`;
        container.style.setProperty('--puter-popup-frame-width', `${box.width}px`);
        container.style.setProperty('--puter-popup-frame-height', `${box.height}px`);
        container.append(frame);
        if ( closeLabel ) {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = `${className}-close`;
            close.setAttribute('aria-label', closeLabel);
            close.title = closeLabel;
            close.innerHTML = CLOSE_ICON;
            close.addEventListener('click', () => finish(dismissed()));
            container.append(close);
        }
        dialog.append(container);
    } else {
        dialog.insertBefore(frame, loading);
    }

    let settled = false;
    let heard = false;
    let shown = false;
    let ready = false;
    let timer = null;
    let loadingTimer = null;
    // Each embed document posts `loading` once; these tell a document that
    // never did (one the server refused) from one that did.
    let loads = 0;
    let boots = 0;
    let wasReady = false;
    let restarted = false;
    let restartTimer = null;
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
        clearTimeout(restartTimer);
        window.removeEventListener('message', onWindowMessage);
        dialog.remove();
        if ( shown ) restoreFocus?.focus?.({ preventScroll: true });
        resolve(result);
    };
    // The spinner is only faded out, so assistive tech hears it only while it shows.
    const setLoading = (on) => {
        dialog.classList.toggle('is-loading', on);
        if ( on ) loading.removeAttribute('aria-hidden');
        else loading.setAttribute('aria-hidden', 'true');
    };
    const show = () => {
        if ( dialog.open ) return;
        shown = true;
        dialog.showModal();
    };
    const onWindowMessage = (event) => {
        if ( event.origin !== origin || event.source !== frame.contentWindow ) return;
        const data = event.data;
        if ( !data || typeof data !== 'object' ) return;
        if ( data.msg !== stateMsg || !['loading', 'ready', 'unavailable'].includes(data.state) ) {
            onMessage(data, finish);
        } else if ( data.state === 'loading' ) {
            heard = true;
            boots++;
            wait(READY_TIMEOUT_MS);
        } else if ( data.state === 'ready' ) {
            heard = true;
            ready = true;
            wasReady = true;
            restarted = false;
            clearTimeout(timer);
            clearTimeout(loadingTimer);
            setLoading(false);
            show();
            frame.focus();
        } else {
            finish(null);
        }
    };
    // A reload or navigation the embed starts itself names the embed, not
    // this page, as its referrer, so the server refuses to let it frame. This
    // page opens the embed again, once, which it allows.
    const restart = () => {
        if ( restarted ) {
            finish(null);
            return;
        }
        restarted = true;
        ready = false;
        loads = boots;
        setLoading(true);
        // As long as its first start may take, then the popup.
        wait(READY_TIMEOUT_MS);
        frame.src = url.href;
    };
    window.addEventListener('message', onWindowMessage);
    frame.addEventListener('load', () => {
        loads++;
        if ( ! heard ) wait(LOAD_GRACE_MS);
        if ( ! wasReady || boots >= loads ) return;
        // Most likely refused: the spinner covers the error page meanwhile.
        ready = false;
        setLoading(true);
        const expected = loads;
        clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
            if ( boots < expected ) restart();
        }, LOAD_GRACE_MS);
    });
    // Once ready, Escape outside the frame would close the dialog with the
    // embed's own dialog still open inside it, so the embed owns dismissal
    // unless it dismisses on Escape too.
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        if ( ready && ! escapeDismisses ) frame.focus();
        else finish(dismissed());
    });
    loading.addEventListener('click', () => {
        if ( ! ready ) finish(dismissed());
    });

    try {
        frame.src = url.href;
        // Hidden at first, so a quickly refused session shows nothing.
        document.body.append(dialog);
        onFrame?.(frame.contentWindow);
        wait(READY_TIMEOUT_MS);
        loadingTimer = setTimeout(() => {
            setLoading(true);
            show();
        }, LOADING_DELAY_MS);
    } catch {
        finish(null);
    }
});

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
export const showFeedbackEmbed = ({ guiOrigin, userUuid }) => mountGuiEmbed({
    guiOrigin,
    path: '/embed/feedback',
    fragment: { user: userUuid },
    className: 'puter-feedback-embed',
    title: 'Send feedback',
    stateMsg: 'feedbackEmbed',
    dismissed: () => ({ sent: false }),
    onMessage: ({ msg, sent }, finish) => {
        if ( msg === 'feedbackDialogClosed' ) finish({ sent: sent === true });
    },
});

/** Popup actions a first-party page shows framed, each in a box its popup window's size. */
const POPUP_FRAME_BOXES = {
    'sign-in': { width: 600, height: 700 },
    'show-open-file-picker': { width: 700, height: 400 },
    'show-save-file-picker': { width: 700, height: 400 },
    'show-directory-picker': { width: 700, height: 400 },
};

/**
 * Shows the GUI popup for `action` in a frame over the page instead of a
 * window, from `/embed/<action>`. The GUI runs the popup unchanged and posts
 * its answers to this page as it would to an opener; `onMessage` sees each of
 * them and finishes with the result. The frame closing on its own, as the
 * popup would, finishes with `closed()`, and so does the user dismissing it.
 * Resolves null when the frame can't serve the request (refused, never
 * answering, or reporting itself unavailable), so the caller can open the
 * popup instead. Never rejects.
 *
 * @template T
 * @param {Object} opts
 * @param {string} opts.guiOrigin
 * @param {'sign-in' | 'show-open-file-picker' | 'show-save-file-picker' | 'show-directory-picker'} opts.action
 * @param {Record<string, string>} opts.fragment - the popup's parameters, and `user` for a picker
 * @param {string} opts.title - the frame's accessible name
 * @param {string} [opts.closeLabel] - puts a close button on the frame
 * @param {() => T} opts.closed
 * @param {(data: Record<string, unknown>, finish: (result: T) => void) => void} opts.onMessage
 * @param {(frame: Window) => void} [opts.onFrame]
 * @returns {Promise<T | null>}
 */
export const showPopupFrame = ({ guiOrigin, action, fragment, title, closeLabel, closed, onMessage, onFrame }) => mountGuiEmbed({
    guiOrigin,
    path: `/embed/${action}`,
    fragment,
    className: 'puter-popup-frame',
    title,
    stateMsg: 'puterPopupFrame',
    box: POPUP_FRAME_BOXES[action],
    closeLabel,
    // Signup and the account checks fill in a texted code, as in the popup.
    allow: 'otp-credentials',
    // Escape inside the frame closes it as well.
    escapeDismisses: true,
    dismissed: closed,
    onFrame,
    onMessage: (data, finish) => {
        if ( data.msg === 'puterPopupFrame' && data.state === 'closed' ) finish(closed());
        else onMessage(data, finish);
    },
});
