/*
 * Shared opener for the account-verification gate windows (the 403
 * `*_required` codes). Used by the global ajax interceptor in initgui.js, the
 * `requestVerificationGate` IPC handler, and the share dialogs, so a gate
 * raised by GUI code and one raised by an app share a single window instead
 * of stacking.
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
