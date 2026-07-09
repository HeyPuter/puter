import { describe, expect, it } from 'vitest';
import { isStoredTokenUsableForOrigin } from './authTokenOrigin.js';

const DEFAULT = 'https://api.puter.com';
const ATTACKER = 'https://attacker.example';

describe('isStoredTokenUsableForOrigin', () => {
    it('allows a bound token only against its own origin', () => {
        expect(
            isStoredTokenUsableForOrigin({
                boundOrigin: DEFAULT,
                currentOrigin: DEFAULT,
                defaultAPIOrigin: DEFAULT,
            }),
        ).toBe(true);
    });

    it('rejects a bound token against a different (URL-supplied) origin', () => {
        // The core exploit: a token minted for the real API must not be
        // replayed to an attacker-controlled origin.
        expect(
            isStoredTokenUsableForOrigin({
                boundOrigin: DEFAULT,
                currentOrigin: ATTACKER,
                defaultAPIOrigin: DEFAULT,
            }),
        ).toBe(false);
    });

    it('honors an unbound (legacy) token against the default origin', () => {
        expect(
            isStoredTokenUsableForOrigin({
                boundOrigin: null,
                currentOrigin: DEFAULT,
                defaultAPIOrigin: DEFAULT,
            }),
        ).toBe(true);
    });

    it('rejects an unbound (legacy) token against a custom origin', () => {
        // Even without a binding, a legacy token can never be sent to a
        // custom URL-supplied origin.
        expect(
            isStoredTokenUsableForOrigin({
                boundOrigin: undefined,
                currentOrigin: ATTACKER,
                defaultAPIOrigin: DEFAULT,
            }),
        ).toBe(false);
    });

    it('binds to a self-hosted default origin', () => {
        // A self-hosted deployment sets its own default API origin; a token
        // bound to it is usable there, and a legacy token is allowed there.
        const selfHosted = 'https://api.my-puter.example';
        expect(
            isStoredTokenUsableForOrigin({
                boundOrigin: selfHosted,
                currentOrigin: selfHosted,
                defaultAPIOrigin: selfHosted,
            }),
        ).toBe(true);
        expect(
            isStoredTokenUsableForOrigin({
                boundOrigin: null,
                currentOrigin: selfHosted,
                defaultAPIOrigin: selfHosted,
            }),
        ).toBe(true);
        // ...but that legacy self-hosted token still can't be redirected.
        expect(
            isStoredTokenUsableForOrigin({
                boundOrigin: null,
                currentOrigin: ATTACKER,
                defaultAPIOrigin: selfHosted,
            }),
        ).toBe(false);
    });
});
