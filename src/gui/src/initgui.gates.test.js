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

describe('the popup token hand-off in postAuthActions', () => {
    const postAuthActions = src.slice(
        src.indexOf('const postAuthActions = async'),
        src.indexOf('window.initgui = async'),
    );
    const gate = postAuthActions.indexOf(
        'if (deliversTokenAtBoot(action) && !consented)',
    );

    it('asks for consent on every action that hands over a token at boot', () => {
        // A gate keyed on action names lets every unnamed action through.
        expect(gate).toBeGreaterThan(-1);
        expect(postAuthActions).not.toContain('is_signin_popup');
    });

    it('checks consent before the exchange and both hand-offs', () => {
        const steps = [
            postAuthActions.indexOf('fetch(`${window.api_origin}/login/set`'),
            postAuthActions.indexOf('runsUserAppTokenExchange(action)'),
            postAuthActions.search(/success: true,\s+token: data\.token/),
        ];
        for (const step of steps) {
            expect(step).toBeGreaterThan(gate);
        }
    });
});

describe('the account pickers in a popup', () => {
    const PICKER = 'picked_a_user_for_sdk_login = await UIWindowSessionList(';

    it('record that they were shown', () => {
        // A dismissed picker has to outrank an existing relationship, so the
        // relationship check needs to know one was shown.
        const chunks = src.split(PICKER);
        expect(chunks.length - 1).toBe(2);
        for (const before of chunks.slice(0, -1)) {
            expect(before.trimEnd()).toMatch(/showed_account_picker = true;$/);
        }
    });

    it('only let the relationship stand in when no picker was shown', () => {
        expect(src).toContain('showedAccountPicker: showed_account_picker');
        expect(src).not.toMatch(/if \(window\.userAppToken\) \{\s*window\.popup_signin_consent = true;/);
    });
});
