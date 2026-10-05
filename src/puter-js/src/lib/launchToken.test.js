import { describe, expect, it } from 'vitest';
import {
    isGodmodeTokenPayload,
    isUserSessionTokenPayload,
    urlWithoutQueryParam,
} from './launchToken.js';

describe('urlWithoutQueryParam', () => {
    it('removes the parameter and keeps the rest of the URL', () => {
        expect(
            urlWithoutQueryParam(
                'https://app.example/p?puter.app_instance_id=i' +
                    '&puter.auth.token=T&x=1#h',
                'puter.auth.token',
            ),
        ).toBe('https://app.example/p?puter.app_instance_id=i&x=1#h');
    });

    it('keeps the encoding of the parameters that stay', () => {
        // Re-serializing through URLSearchParams would turn %20 into `+`,
        // which changes the value for apps that parse the query by hand.
        expect(
            urlWithoutQueryParam(
                'https://app.example/?puter.item.name=My%20File%2B1.txt' +
                    '&puter.auth.token=T&puter.args=%7B%22a%22%3A1%7D',
                'puter.auth.token',
            ),
        ).toBe(
            'https://app.example/?puter.item.name=My%20File%2B1.txt&puter.args=%7B%22a%22%3A1%7D',
        );
    });

    it('drops the query entirely when nothing else is left', () => {
        expect(
            urlWithoutQueryParam(
                'https://app.example/index.html?puter.auth.token=T',
                'puter.auth.token',
            ),
        ).toBe('https://app.example/index.html');
    });

    it('removes every occurrence, including a percent-encoded key', () => {
        expect(
            urlWithoutQueryParam(
                'https://app.example/?auth_token=a&k=v&auth%5Ftoken=b',
                'auth_token',
            ),
        ).toBe('https://app.example/?k=v');
    });

    it('leaves parameters that only share a prefix', () => {
        expect(
            urlWithoutQueryParam(
                'https://app.example/?puter.auth.token=T&puter.auth.username=u',
                'puter.auth.token',
            ),
        ).toBe('https://app.example/?puter.auth.username=u');
    });

    it('returns null when there is nothing to remove', () => {
        expect(
            urlWithoutQueryParam(
                'https://app.example/?puter.auth.username=u',
                'puter.auth.token',
            ),
        ).toBeNull();
        expect(
            urlWithoutQueryParam('https://app.example/', 'puter.auth.token'),
        ).toBeNull();
        expect(urlWithoutQueryParam('not a url', 'puter.auth.token')).toBeNull();
    });
});

describe('isUserSessionTokenPayload', () => {
    it('matches the desktop session token and plain session tokens', () => {
        expect(isUserSessionTokenPayload({ t: 'gui', v: '2' })).toBe(true);
        expect(isUserSessionTokenPayload({ t: 's', v: '2' })).toBe(true);
        expect(isUserSessionTokenPayload({ type: 'gui' })).toBe(true);
        expect(isUserSessionTokenPayload({ type: 'session' })).toBe(true);
    });

    it('matches a godmode app launch token', () => {
        expect(
            isUserSessionTokenPayload({
                t: 't',
                full_access: true,
                godmode_app_uid: 'app-1',
            }),
        ).toBe(true);
    });

    it('does not match app or access tokens', () => {
        expect(isUserSessionTokenPayload({ t: 'au', au: 'x' })).toBe(false);
        expect(isUserSessionTokenPayload({ t: 't' })).toBe(false);
        expect(isUserSessionTokenPayload({ type: 'app-under-user' })).toBe(
            false,
        );
        expect(isUserSessionTokenPayload({})).toBe(false);
        expect(isUserSessionTokenPayload(null)).toBe(false);
    });
});

describe('isGodmodeTokenPayload', () => {
    it('matches only a token carrying the godmode app', () => {
        expect(
            isGodmodeTokenPayload({
                t: 't',
                full_access: true,
                godmode_app_uid: 'app-1',
            }),
        ).toBe(true);
        expect(isGodmodeTokenPayload({ t: 't', full_access: true })).toBe(
            false,
        );
        expect(isGodmodeTokenPayload({ t: 'gui' })).toBe(false);
        expect(isGodmodeTokenPayload({ godmode_app_uid: '' })).toBe(false);
        expect(isGodmodeTokenPayload(null)).toBe(false);
    });
});
