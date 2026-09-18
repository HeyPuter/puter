import { describe, it, expect } from 'vitest';
import {
    appHostOf,
    buildRequestBody,
    looksLikeEmail,
    magicLinkOffered,
    nextAuthWindow,
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

describe('buildRequestBody for Puter itself', () => {
    it('omits the opener and return URL so the backend lands on the desktop', () => {
        expect(buildRequestBody({ email: 'someone@example.com' })).toEqual({
            email: 'someone@example.com',
        });
    });
});

describe('magicLinkOffered', () => {
    const params = new URLSearchParams({ return_url: 'https://todo.example/app' });

    it('is offered when the popup carries a return URL on the opener', () => {
        expect(magicLinkOffered({ embeddedInPopup: true, openerOrigin: 'https://todo.example', params })).toBe(true);
    });

    it('is not offered outside a popup, without a return URL, or with a foreign one', () => {
        expect(magicLinkOffered({ embeddedInPopup: false, openerOrigin: 'https://todo.example', params })).toBe(false);
        expect(magicLinkOffered({ embeddedInPopup: true, openerOrigin: 'https://todo.example', params: new URLSearchParams() })).toBe(false);
        expect(magicLinkOffered({ embeddedInPopup: true, openerOrigin: 'https://other.example', params })).toBe(false);
        expect(magicLinkOffered({ embeddedInPopup: true, openerOrigin: null, params })).toBe(false);
    });
});

describe('nextAuthWindow', () => {
    it('routes to the window a result asks for', () => {
        expect(nextAuthWindow({ next: 'login' })).toBe('login');
        expect(nextAuthWindow({ next: 'magic', email: 'a@b.co' })).toBe('magic');
        expect(nextAuthWindow({ next: 'signup' })).toBe('signup');
    });

    it('stops on a dismissal, a sign-in, or an unknown target', () => {
        expect(nextAuthWindow(false)).toBeNull();
        expect(nextAuthWindow(true)).toBeNull();
        expect(nextAuthWindow({ next: 'elsewhere' })).toBeNull();
        expect(nextAuthWindow(undefined)).toBeNull();
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

describe('buildRequestBody', () => {
    const base = {
        email: ' someone@example.com ',
        returnUrl: 'https://todo.example/list',
        openerOrigin: 'https://todo.example',
    };

    it('produces the wire shape with a trimmed email', () => {
        expect(buildRequestBody(base)).toEqual({
            email: 'someone@example.com',
            return_url: base.returnUrl,
            opener_origin: 'https://todo.example',
        });
    });

    it('returns null when any input cannot make a valid request', () => {
        expect(buildRequestBody({ ...base, email: 'nope' })).toBeNull();
        expect(buildRequestBody({ ...base, returnUrl: 'https://evil.example/' })).toBeNull();
        expect(buildRequestBody({ ...base, openerOrigin: 'ftp://x' })).toBeNull();
    });
});
