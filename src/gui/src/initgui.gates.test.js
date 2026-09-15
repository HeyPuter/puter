import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * `initgui` runs the verification gates in two places: the token-in-URL path
 * and the session-restore/login path. A gate added to one and not the other
 * looks correct in review and is only visible by signing in the wrong way --
 * which is how the forced password change shipped running on neither the login
 * form nor a normal reload.
 */
const src = readFileSync(
    new URL('./initgui.js', import.meta.url),
    'utf8',
);

const countGates = (flag) =>
    src.split(`whoami.${flag}`).length - 1;

describe('the verification gates in initgui', () => {
    it('runs the email gate on both paths', () => {
        expect(countGates('requires_email_confirmation')).toBe(2);
    });

    it('runs the card gate on both paths', () => {
        expect(countGates('requires_card_verification')).toBe(2);
    });

    it('runs the forced password change on both paths', () => {
        // A seat signs in through the login form; a gate only on the
        // token-in-URL path never fires for it.
        expect(countGates('requires_password_change')).toBe(2);
    });

    it('loops each gate until it is cleared, so none can be dismissed', () => {
        // Every gate is a `do { ... } while (!x)`; a plain `if` would let the
        // window close and the account through.
        const opens = src.split('UIWindowPasswordChangeRequired({').length - 1;
        expect(opens).toBe(2);
        for (const chunk of src.split('UIWindowPasswordChangeRequired({').slice(1)) {
            expect(chunk).toContain('} while (!changed);');
        }
    });
});
