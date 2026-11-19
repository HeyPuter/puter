/*
 * Shared opener for the account-verification gate windows (the 403
 * `*_required` codes). Used by the global ajax interceptor in initgui.js, the
 * `requestVerificationGate` IPC handler, and the share dialogs, so a gate
 * raised by GUI code and one raised by an app share a single window instead
 * of stacking. Also the run of gates a signup or login goes through when it
 * comes back with some set.
 */

import UIWindowEmailConfirmationRequired from '../UI/UIWindowEmailConfirmationRequired.js';
import UIWindowPhoneVerificationRequired from '../UI/UIWindowPhoneVerificationRequired.js';
import UIWindowCardVerificationRequired from '../UI/UIWindowCardVerificationRequired.js';

const gate_windows = {
    phone_verification_required: UIWindowPhoneVerificationRequired,
    email_confirmation_required: UIWindowEmailConfirmationRequired,
    card_verification_required: UIWindowCardVerificationRequired,
};

// Single-flight: while a gate window is open, every caller awaits the same
// resolution regardless of which code they arrived with — a caller whose gate
// is actually a different one just retries and raises it then.
let pending = null;

/**
 * Whether a rejection is a verification gate this module can open a window for.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const is_verification_gate_error = (error) =>
    Boolean(error && typeof error === 'object' && gate_windows[error.code]);

/**
 * Open the gate window for a verification error code and resolve `true` when
 * the user clears it (user data is refreshed first). Unknown codes resolve
 * `false` without opening anything.
 *
 * Without `factors` this is the account gate: the window cannot be dismissed
 * and logging out is the only other way past it. With `factors` a route asked
 * for a verified factor rather than the account being flagged, so the window
 * is a step the user may back out of, and when the server accepts a card too
 * the phone window offers it alongside.
 *
 * @param {string} code - The 403 error code (e.g. `phone_verification_required`).
 * @param {{ factors?: string[] }} [options]
 * @returns {Promise<boolean>}
 */
export async function openVerificationGateWindow (code, { factors } = {}) {
    const UIWindowVerificationGate = gate_windows[code];
    if ( !UIWindowVerificationGate ) {
        return false;
    }
    if ( !pending ) {
        pending = (async () => {
            try {
                const window_options = Array.isArray(factors)
                    ? {
                        stay_on_top: true,
                        has_head: false,
                        card_alternative: factors.includes('card'),
                        window_options: {
                            is_draggable: true,
                        },
                    }
                    : {
                        show_close_button: false,
                        stay_on_top: true,
                        has_head: false,
                        logout_in_footer: true,
                        window_options: {
                            is_draggable: false,
                        },
                    };
                // The gate window resolves truthy once cleared (the phone gate
                // resolves the string 'card' when a card cleared it).
                const is_verified = await UIWindowVerificationGate(window_options);
                if ( is_verified ) {
                    await window.refresh_user_data(window.auth_token);
                }
                return Boolean(is_verified);
            } catch (e) {
                console.error('verification gate dialog failed:', e);
                return false;
            } finally {
                pending = null;
            }
        })();
    }
    return pending;
}

/**
 * Run `fn`; if a verification gate refuses it, walk the user through the gate
 * and run `fn` once more. A gate the user backs out of rethrows the refusal,
 * so the caller reports it the way it reports any other failure.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function with_verification_gate (fn) {
    try {
        return await fn();
    } catch (e) {
        if ( ! is_verification_gate_error(e) ) throw e;
        const cleared = await openVerificationGateWindow(e.code, { factors: e.factors });
        if ( ! cleared ) throw e;
        return await fn();
    }
}

/**
 * Runs the checks a just-signed-in account has to pass, in the server's order
 * (see assertVerifiedAccount): email → phone (SMS) → card, or card → phone →
 * email when the account clears email last.
 *
 * @param {object} user The account, as the signup or login answered.
 * @param {boolean} show_email Ask for the emailed code here.
 * @param {boolean} reload_on_success
 * @param {boolean} page The sign-in was a page, so the checks cover it too
 *   rather than float over whatever was under it.
 * @returns {Promise<boolean>} Whether the email was confirmed (true when not asked).
 */
export const runVerificationGates = async (user, show_email, reload_on_success, page) => {
    const window_options = page ? { cover_page: true, has_head: false } : {};
    let email_verified = true;
    const emailGate = async () => {
        if ( ! show_email ) return;
        // No ✕: the auth card it replaced is already gone, so there's
        // nothing to go back to.
        email_verified = await UIWindowEmailConfirmationRequired({
            show_close_button: false,
            stay_on_top: true,
            has_head: true,
            reload_on_success,
            window_options,
        });
    };
    // A user the SMS path keeps failing may take the card fallback instead;
    // that resolves 'card' and clears the card gate along with the phone
    // gate (see UIWindowPhoneVerificationRequired).
    let card_cleared_by_fallback = false;
    const phoneGate = async () => {
        if ( ! user?.requires_phone_verification ) return;
        let phone_ok = false;
        do {
            phone_ok = await UIWindowPhoneVerificationRequired({
                show_close_button: false,
                stay_on_top: true,
                has_head: true,
                card_fallback_available: user.card_fallback_available,
                window_options,
            });
        } while ( ! phone_ok );
        card_cleared_by_fallback = phone_ok === 'card';
    };
    const cardGate = async () => {
        if ( ! user?.requires_card_verification || card_cleared_by_fallback ) return;
        let card_ok = false;
        do {
            card_ok = await UIWindowCardVerificationRequired({
                show_close_button: false,
                stay_on_top: true,
                has_head: true,
                window_options,
            });
        } while ( ! card_ok );
    };
    if ( user?.email_gate_last ) {
        await cardGate();
        await phoneGate();
        await emailGate();
    } else {
        await emailGate();
        await phoneGate();
        await cardGate();
    }
    return email_verified;
};
