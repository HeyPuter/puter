/**
 * Shared helpers for opening Puter authentication popup windows.
 *
 * Browsers only allow `window.open()` to spawn a real popup (instead of
 * silently blocking it) while the document has user activation — i.e.
 * during or shortly after a user gesture such as a click. Every Puter auth
 * flow needs the same activation check and the same popup geometry, so this
 * module is the single source of truth for both.
 *
 * Keeping this in one place is what prevents the flows from drifting apart:
 * previously the implicit-auth flow had an activation check + consent-dialog
 * fallback while `puter.auth.signIn()` opened the popup unconditionally and
 * got popup-blocked when called without a user gesture.
 */

// Auth popup window dimensions.
const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;

/**
 * Detects whether the document currently has user activation, which the
 * browser requires in order to open a popup without blocking it.
 *
 * @returns {boolean} True if a popup can be opened right now.
 */
export const hasUserActivation = () => {
    // Modern browsers expose the User Activation API.
    if ( navigator.userActivation ) {
        return navigator.userActivation.hasBeenActive && navigator.userActivation.isActive;
    }

    // Fallback for browsers without the API: probe by attempting to open a
    // tiny off-screen popup. If it succeeds, a user gesture is active; close
    // it immediately. This is hacky, but it is the only signal available.
    try {
        const testPopup = window.open('', '_blank', 'width=1,height=1,left=-1000,top=-1000');
        if ( testPopup ) {
            testPopup.close();
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
};

/**
 * Opens a centered Puter authentication popup window.
 *
 * This must be called synchronously from within a user gesture (e.g. a click
 * handler), or the browser will block the popup. Callers must gate any
 * non-gesture invocation behind `hasUserActivation()` and fall back to a
 * consent dialog (which collects a gesture) when there is no activation.
 *
 * @param {string} url - The full URL (including query string) to load.
 * @param {string} [title='Puter'] - The popup window name.
 * @returns {Window|null} The popup window, or null if the browser blocked it.
 */
export const openAuthPopup = (url, title = 'Puter') => {
    const left = (screen.width / 2) - (POPUP_WIDTH / 2);
    const top = (screen.height / 2) - (POPUP_HEIGHT / 2);
    return window.open(
        url,
        title,
        `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=no, resizable=no, copyhistory=no, width=${POPUP_WIDTH}, height=${POPUP_HEIGHT}, top=${top}, left=${left}`,
    );
};
