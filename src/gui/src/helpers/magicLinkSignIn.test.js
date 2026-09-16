import { describe, it, expect } from 'vitest';
import {
    appHostOf,
    buildRequestBody,
    generatePopupSecret,
    looksLikeEmail,
    originOf,
    returnUrlAllowed,
} from './magicLinkSignIn.js';

describe('originOf', () => {
    it('returns the origin of an http(s) URL', () => {
        expect(originOf('https://todo.example/list?x=1')).toBe('https://todo.example');
        expect(originOf('http://localhost:8081/')).toBe('http://localhost:8081');
    });

    it('rejects other schemes and garbage', () => {
        expect(originOf('javascript:alert(1)')).toBeNull();
        expect(originOf('file:///tmp/x.html')).toBeNull();
        expect(originOf('not a url')).toBeNull();
        expect(originOf(null)).toBeNull();
    });
});

describe('returnUrlAllowed', () => {
    it('accepts a return URL on the opener origin', () => {
        expect(returnUrlAllowed('https://todo.example/a?b=c', 'https://todo.example')).toBe(true);
    });

    it('rejects another origin, including lookalikes', () => {
        expect(returnUrlAllowed('https://todo.example.evil/', 'https://todo.example')).toBe(false);
        expect(returnUrlAllowed('https://todo.example:8443/', 'https://todo.example')).toBe(false);
        expect(returnUrlAllowed('http://todo.example/', 'https://todo.example')).toBe(false);
    });
});

describe('appHostOf', () => {
    it('shows the host with its port', () => {
        expect(appHostOf('http://localhost:8081')).toBe('localhost:8081');
        expect(appHostOf('https://todo.example')).toBe('todo.example');
    });
});

describe('looksLikeEmail', () => {
    it('accepts a plain address and rejects obvious non-addresses', () => {
        expect(looksLikeEmail('a@b.co')).toBe(true);
        expect(looksLikeEmail(' a@b.co ')).toBe(true);
        expect(looksLikeEmail('a@b')).toBe(false);
        expect(looksLikeEmail('nope')).toBe(false);
        expect(looksLikeEmail(undefined)).toBe(false);
    });
});

describe('generatePopupSecret', () => {
    it('hex-encodes 32 random bytes', () => {
        const secret = generatePopupSecret(n => new Uint8Array(n).fill(0xab));
        expect(secret).toBe('ab'.repeat(32));
    });
});

describe('buildRequestBody', () => {
    const base = {
        email: ' someone@example.com ',
        session: '11111111-2222-4333-8444-666666666666',
        returnUrl: 'https://todo.example/list',
        openerOrigin: 'https://todo.example',
        popupSecret: 's'.repeat(32),
    };

    it('produces the wire shape with a trimmed email', () => {
        expect(buildRequestBody(base)).toEqual({
            email: 'someone@example.com',
            session: base.session,
            return_url: base.returnUrl,
            opener_origin: 'https://todo.example',
            popup_secret: base.popupSecret,
        });
    });

    it('returns null when any input cannot make a valid request', () => {
        expect(buildRequestBody({ ...base, email: 'nope' })).toBeNull();
        expect(buildRequestBody({ ...base, returnUrl: 'https://evil.example/' })).toBeNull();
        expect(buildRequestBody({ ...base, openerOrigin: 'ftp://x' })).toBeNull();
        expect(buildRequestBody({ ...base, popupSecret: '' })).toBeNull();
    });
});
