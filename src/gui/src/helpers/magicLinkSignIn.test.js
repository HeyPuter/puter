import { describe, it, expect } from 'vitest';
import {
    announceMagicLinkSignIn,
    appHostOf,
    consumeErrorMessage,
    looksLikeEmail,
    oidcProviderForEmail,
    watchMagicLinkSignIn,
} from './magicLinkSignIn.js';

describe('looksLikeEmail', () => {
    it('accepts ordinary addresses, trimmed', () => {
        expect(looksLikeEmail('someone@example.com')).toBe(true);
        expect(looksLikeEmail('  someone@example.com ')).toBe(true);
    });

    it('rejects usernames, blanks and non-strings', () => {
        expect(looksLikeEmail('someone')).toBe(false);
        expect(looksLikeEmail('someone@localhost')).toBe(false);
        expect(looksLikeEmail('')).toBe(false);
        expect(looksLikeEmail(undefined)).toBe(false);
    });
});

describe('oidcProviderForEmail', () => {
    const all = ['google', 'microsoft', 'apple'];

    it('routes consumer Google and Microsoft addresses to their provider', () => {
        expect(oidcProviderForEmail('a@gmail.com', all)).toBe('google');
        expect(oidcProviderForEmail('A@GoogleMail.com', all)).toBe('google');
        expect(oidcProviderForEmail('a@outlook.com', all)).toBe('microsoft');
        expect(oidcProviderForEmail('a@hotmail.com', all)).toBe('microsoft');
    });

    it('sends every other address to a link', () => {
        expect(oidcProviderForEmail('a@example.com', all)).toBeNull();
        // Apple can hand back a relay address instead of this one.
        expect(oidcProviderForEmail('a@icloud.com', all)).toBeNull();
        // A lookalike subdomain is not the provider's domain.
        expect(oidcProviderForEmail('a@gmail.com.evil.test', all)).toBeNull();
    });

    it('only routes to a provider this deployment enabled', () => {
        expect(oidcProviderForEmail('a@gmail.com', ['microsoft'])).toBeNull();
        expect(oidcProviderForEmail('a@gmail.com', [])).toBeNull();
        expect(oidcProviderForEmail('a@gmail.com', undefined)).toBeNull();
    });

    it('routes nothing for a malformed address', () => {
        expect(oidcProviderForEmail('gmail.com', all)).toBeNull();
    });
});

describe('appHostOf', () => {
    it('returns the host, port included', () => {
        expect(appHostOf('https://todo.example')).toBe('todo.example');
        expect(appHostOf('http://localhost:8081')).toBe('localhost:8081');
    });

    it('returns an empty string for anything unparseable', () => {
        expect(appHostOf('not a url')).toBe('');
        expect(appHostOf(null)).toBe('');
    });
});

describe('consumeErrorMessage', () => {
    it('maps known codes to their translation key', () => {
        expect(consumeErrorMessage(400, { code: 'link_expired' })).toEqual({ key: 'magic_link_expired_message' });
        expect(consumeErrorMessage(401, { code: 'account_suspended' })).toEqual({ key: 'account_suspended_message' });
        expect(consumeErrorMessage(429, null)).toEqual({ key: 'magic_link_too_many_requests' });
    });

    it('shows the server text for blocked signups and unconfirmed accounts', () => {
        expect(consumeErrorMessage(403, {
            code: 'signup_blocked',
            message: 'Signup blocked Request Code: abc',
        })).toEqual({ text: 'Signup blocked Request Code: abc' });
        expect(consumeErrorMessage(400, {
            code: 'email_unconfirmed',
            message: 'Sign in with your password to confirm it first.',
        })).toEqual({ text: 'Sign in with your password to confirm it first.' });
    });

    it('falls back to the generic message', () => {
        expect(consumeErrorMessage(403, { code: 'signup_blocked' })).toEqual({ key: 'auth_error_generic' });
        expect(consumeErrorMessage(500, { code: 'internal_error', message: 'boom' })).toEqual({ key: 'auth_error_generic' });
        expect(consumeErrorMessage(400, null)).toEqual({ key: 'auth_error_generic' });
    });
});

// Two ends of one BroadcastChannel name: a message posted on one end reaches
// the others, never itself.
const fakeChannelPair = () => {
    const ends = [];
    const open = () => {
        const end = {
            onmessage: null,
            closed: false,
            postMessage (data) {
                for ( const other of ends ) {
                    if ( other !== end && !other.closed ) other.onmessage?.({ data });
                }
            },
            close () {
                end.closed = true;
            },
        };
        ends.push(end);
        return end;
    };
    return { open, ends };
};

describe('magic link hand-off between tabs', () => {
    it('signs the waiting window in and tells the link tab it answered', async () => {
        const { open } = fakeChannelPair();
        const signedIn = [];
        watchMagicLinkSignIn({ requestId: 'r1', openChannel: open, onSignedIn: (uuid) => signedIn.push(uuid) });
        const acked = await announceMagicLinkSignIn({ requestId: 'r1', userUuid: 'u1', openChannel: open, timeoutMs: 50 });
        expect(acked).toBe(true);
        expect(signedIn).toEqual(['u1']);
    });

    it('ignores a link another window asked for', async () => {
        const { open } = fakeChannelPair();
        const signedIn = [];
        watchMagicLinkSignIn({ requestId: 'r1', openChannel: open, onSignedIn: (uuid) => signedIn.push(uuid) });
        const acked = await announceMagicLinkSignIn({ requestId: 'r2', userUuid: 'u1', openChannel: open, timeoutMs: 20 });
        expect(acked).toBe(false);
        expect(signedIn).toEqual([]);
    });

    it('reports no answer when no window is waiting or channels are unavailable', async () => {
        const { open, ends } = fakeChannelPair();
        expect(await announceMagicLinkSignIn({ requestId: 'r1', userUuid: 'u1', openChannel: open, timeoutMs: 10 })).toBe(false);
        expect(ends[0].closed).toBe(true);
        const unavailable = () => {
            throw new ReferenceError('BroadcastChannel is not defined');
        };
        expect(await announceMagicLinkSignIn({ requestId: 'r1', userUuid: 'u1', openChannel: unavailable })).toBe(false);
        expect(typeof watchMagicLinkSignIn({ requestId: 'r1', openChannel: unavailable, onSignedIn: () => {} })).toBe('function');
    });

    it('stops listening once the waiting window gives up', async () => {
        const { open } = fakeChannelPair();
        const signedIn = [];
        const stop = watchMagicLinkSignIn({ requestId: 'r1', openChannel: open, onSignedIn: (uuid) => signedIn.push(uuid) });
        stop();
        expect(await announceMagicLinkSignIn({ requestId: 'r1', userUuid: 'u1', openChannel: open, timeoutMs: 10 })).toBe(false);
        expect(signedIn).toEqual([]);
    });
});
