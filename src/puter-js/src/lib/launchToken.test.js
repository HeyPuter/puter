import { describe, expect, it, vi } from 'vitest';
import {
    isGodmodeTokenPayload,
    isUserSessionTokenPayload,
    keepLaunchItem,
    requestLaunchFromOpener,
    takeKeptLaunchItem,
    tokenTag,
    urlWithoutQueryParams,
} from './launchToken.js';

describe('urlWithoutQueryParams', () => {
    const named = (target) => (name) => name === target;

    it('removes the matching parameter and keeps the rest of the URL', () => {
        expect(
            urlWithoutQueryParams(
                'https://app.example/p?puter.app_instance_id=i' +
                    '&puter.auth.token=T&x=1#h',
                named('puter.auth.token'),
            ),
        ).toBe('https://app.example/p?puter.app_instance_id=i&x=1#h');
    });

    it('removes every parameter the predicate matches', () => {
        expect(
            urlWithoutQueryParams(
                'https://app.example/p?puter.app_instance_id=i&page=2' +
                    '&puter.args=%7B%7D&utm_source=puter.com#h',
                (name) => name.startsWith('puter.'),
            ),
        ).toBe('https://app.example/p?page=2&utm_source=puter.com#h');
    });

    it('keeps the encoding of the parameters that stay', () => {
        // Re-serializing through URLSearchParams would turn %20 into `+`,
        // which changes the value for apps that parse the query by hand.
        expect(
            urlWithoutQueryParams(
                'https://app.example/?puter.item.name=My%20File%2B1.txt' +
                    '&puter.auth.token=T&puter.args=%7B%22a%22%3A1%7D',
                named('puter.auth.token'),
            ),
        ).toBe(
            'https://app.example/?puter.item.name=My%20File%2B1.txt&puter.args=%7B%22a%22%3A1%7D',
        );
    });

    it('drops the query entirely when nothing else is left', () => {
        expect(
            urlWithoutQueryParams(
                'https://app.example/index.html?puter.auth.token=T',
                named('puter.auth.token'),
            ),
        ).toBe('https://app.example/index.html');
    });

    it('removes every occurrence, including a percent-encoded key', () => {
        expect(
            urlWithoutQueryParams(
                'https://app.example/?auth_token=a&k=v&auth%5Ftoken=b',
                named('auth_token'),
            ),
        ).toBe('https://app.example/?k=v');
    });

    it('leaves parameters that only share a prefix', () => {
        expect(
            urlWithoutQueryParams(
                'https://app.example/?puter.auth.token=T&puter.auth.username=u',
                named('puter.auth.token'),
            ),
        ).toBe('https://app.example/?puter.auth.username=u');
    });

    it('returns null when there is nothing to remove', () => {
        expect(
            urlWithoutQueryParams(
                'https://app.example/?puter.auth.username=u',
                named('puter.auth.token'),
            ),
        ).toBeNull();
        expect(
            urlWithoutQueryParams(
                'https://app.example/',
                named('puter.auth.token'),
            ),
        ).toBeNull();
        expect(
            urlWithoutQueryParams('not a url', named('puter.auth.token')),
        ).toBeNull();
    });
});

describe('kept launch items', () => {
    const memoryScope = () => {
        const map = new Map();
        return {
            sessionStorage: {
                getItem: (key) => (map.has(key) ? map.get(key) : null),
                setItem: (key, value) => map.set(key, String(value)),
                removeItem: (key) => map.delete(key),
            },
            map,
        };
    };
    const item = { 'puter.item.uid': 'f-1', 'puter.item.name': 'a.txt' };
    const keep = (scope, now, extra = {}) =>
        keepLaunchItem({ appInstanceID: 'i-1', item, token: 'T', scope, now, ...extra });
    const take = (scope, now, extra = {}) =>
        takeKeptLaunchItem({ appInstanceID: 'i-1', token: 'T', scope, now, ...extra });

    it('hands the item to the next page of the same launch, once', () => {
        const scope = memoryScope();
        keep(scope, 1000);

        expect(take(scope, 2000)).toEqual(item);
        expect(take(scope, 2000)).toBeNull();
    });

    it('keeps a fingerprint of the token, not the token', () => {
        const scope = memoryScope();
        keep(scope, 1000, { token: 'header.payload.signature' });

        expect([...scope.map.values()].join()).not.toContain('signature');
    });

    it('drops an item kept for another launch or another token', () => {
        const scope = memoryScope();
        keep(scope, 1000);
        expect(take(scope, 2000, { appInstanceID: 'i-2' })).toBeNull();
        expect(scope.map.size).toBe(0);

        keep(scope, 1000);
        expect(take(scope, 2000, { token: 'OTHER' })).toBeNull();
        keep(scope, 1000);
        expect(take(scope, 2000, { token: null })).toBeNull();
    });

    it('drops an item kept too long ago, or with a time in the future', () => {
        const scope = memoryScope();
        keep(scope, 0);
        expect(take(scope, 5 * 60 * 1000 + 1)).toBeNull();

        keep(scope, 10_000);
        expect(take(scope, 0)).toBeNull();
    });

    it('keeps only puter.item.* string params', () => {
        const scope = memoryScope();
        keep(scope, 1000, {
            item: { ...item, 'puter.auth.token': 'T', 'puter.item.size': 3 },
        });

        expect(take(scope, 1000)).toEqual(item);
    });

    it('returns null for a malformed entry', () => {
        const scope = memoryScope();
        scope.sessionStorage.setItem('puter.launch.keptItem', '{not json');
        expect(take(scope)).toBeNull();
    });

    it('does nothing where storage is blocked', () => {
        const blocked = {
            get sessionStorage() {
                throw new DOMException('denied', 'SecurityError');
            },
        };
        expect(() => keep(blocked)).not.toThrow();
        expect(take(blocked)).toBeNull();
    });
});

describe('tokenTag', () => {
    it('is stable for a token and differs between tokens', () => {
        expect(tokenTag('a.b.c')).toBe(tokenTag('a.b.c'));
        expect(tokenTag('a.b.c')).not.toBe(tokenTag('a.b.d'));
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

describe('requestLaunchFromOpener', () => {
    const GUI = 'https://puter.com';

    /** A top-level tab whose opener answers with `reply` (or not at all). */
    const makeScope = ({ reply } = {}) => {
        const listeners = new Set();
        const scope = {
            addEventListener: (_type, fn) => listeners.add(fn),
            removeEventListener: (_type, fn) => listeners.delete(fn),
            listeners,
        };
        scope.emit = (event) => {
            for (const fn of [...listeners]) fn(event);
        };
        scope.opener = {
            postMessage: vi.fn((data, targetOrigin) => {
                if (reply) queueMicrotask(() => reply(scope, data, targetOrigin));
            }),
        };
        return scope;
    };

    it('takes the launch the GUI opener sends for this instance, then cuts the opener off', async () => {
        const scope = makeScope({
            reply: (s, data) => s.emit({
                origin: GUI,
                source: opener,
                data: {
                    msg: 'puter.launch',
                    appInstanceID: data.appInstanceID,
                    token: 'tok',
                    item: { 'puter.item.uid': 'f-1', 'puter.item.read_url': 'r', other: 'x', 'puter.item.size': 5 },
                },
            }),
        });
        const opener = scope.opener;
        const launch = await requestLaunchFromOpener({ guiOrigin: GUI, appInstanceID: 'i-1', scope });
        expect(launch).toEqual({
            token: 'tok',
            item: { 'puter.item.uid': 'f-1', 'puter.item.read_url': 'r' },
        });
        expect(opener.postMessage).toHaveBeenCalledWith(
            { msg: 'puter.requestLaunch', env: 'app-tab', appInstanceID: 'i-1' },
            GUI,
        );
        expect(scope.opener).toBeNull();
        expect(scope.listeners.size).toBe(0);
    });

    it('ignores replies from another origin, another window, or another instance', async () => {
        vi.useFakeTimers();
        try {
            const scope = makeScope();
            const opener = scope.opener;
            const pending = requestLaunchFromOpener({ guiOrigin: GUI, appInstanceID: 'i-1', scope, timeoutMs: 1000 });
            const data = { msg: 'puter.launch', appInstanceID: 'i-1', token: 'bad' };
            scope.emit({ origin: 'https://evil.example', source: opener, data });
            scope.emit({ origin: GUI, source: {}, data });
            scope.emit({ origin: GUI, source: opener, data: { ...data, appInstanceID: 'i-2' } });
            vi.advanceTimersByTime(1000);
            expect(await pending).toBeNull();
            expect(scope.opener).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves alone a page this app opened from its own origin', () => {
        const scope = makeScope();
        scope.location = { origin: 'https://app.example' };
        scope.opener.location = { origin: 'https://app.example' };
        const opener = scope.opener;
        expect(requestLaunchFromOpener({ guiOrigin: GUI, appInstanceID: 'i-1', scope })).toBeNull();
        expect(opener.postMessage).not.toHaveBeenCalled();
        expect(scope.opener).toBe(opener);
    });

    it('asks a cross-origin opener, as the GUI is', () => {
        const scope = makeScope();
        scope.location = { origin: 'https://app.example' };
        Object.defineProperty(scope.opener, 'location', {
            get () {
                throw new DOMException('Blocked a frame', 'SecurityError');
            },
        });
        expect(requestLaunchFromOpener({ guiOrigin: GUI, appInstanceID: 'i-1', scope })).toBeInstanceOf(Promise);
        expect(scope.opener.postMessage).toHaveBeenCalledOnce();
    });

    // Synchronously, so there is no pending launch for callers to wait on.
    it('returns null without asking when there is no opener', () => {
        const scope = makeScope();
        scope.opener = null;
        expect(requestLaunchFromOpener({ guiOrigin: GUI, appInstanceID: 'i-1', scope })).toBeNull();
    });

    it('returns null without waiting when the GUI tab was closed', () => {
        const scope = makeScope();
        scope.opener.closed = true;
        expect(requestLaunchFromOpener({ guiOrigin: GUI, appInstanceID: 'i-1', scope })).toBeNull();
        expect(scope.opener.postMessage).not.toHaveBeenCalled();
        expect(scope.listeners.size).toBe(0);
    });
});
