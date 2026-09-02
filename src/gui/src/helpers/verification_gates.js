/*
 * Shared opener for the account-verification gate windows (the 403
 * `*_required` codes). Used by the global ajax interceptor in initgui.js and
 * by the `requestPhoneVerification` IPC handler, so a gate raised by GUI code
 * and one raised by an app share a single window instead of stacking.
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
 * Open the gate window for a verification error code and resolve `true` when
 * the user clears it (user data is refreshed first). Unknown codes resolve
 * `false` without opening anything.
 *
 * @param {string} code - The 403 error code (e.g. `phone_verification_required`).
 * @returns {Promise<boolean>}
 */
export async function openVerificationGateWindow (code) {
    const UIWindowVerificationGate = gate_windows[code];
    if ( !UIWindowVerificationGate ) {
        return false;
    }
    if ( !pending ) {
        pending = (async () => {
            try {
                // The gate window resolves truthy once cleared (the phone gate
                // resolves the string 'card' when the card fallback cleared it).
                const is_verified = await UIWindowVerificationGate({
                    show_close_button: false,
                    stay_on_top: true,
                    has_head: false,
                    logout_in_footer: true,
                    window_options: {
                        is_draggable: false,
                    },
                });
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
