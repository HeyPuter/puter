// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Handlers the FS socket registered, by event name. */
const socketHandlers = vi.hoisted(() => ({}));

vi.mock('socket.io-client', () => ({
    io: () => ({
        on: (name, fn) => {
            socketHandlers[name] = fn;
        },
        off: vi.fn(),
        emit: vi.fn(),
        disconnect: vi.fn(),
        active: true,
    }),
}));
vi.mock('./lib/polyfills/localStorage.js', () => ({ default: {} }));
vi.mock('./lib/polyfills/xhrshim.js', () => ({ default: class {} }));

const origDefine = customElements.define.bind(customElements);
customElements.define = (name, cls) =>
    customElements.get(name) || origDefine(name, cls);

const TOKEN = 'gui-session-token';

/** Path of every request the SDK sent, in order. */
const sent = [];

/** What `/fs/readdir` lists, by folder. */
const listings = {};

const dirEntry = (path) => ({
    uid: `uid-${path}`,
    name: path.split('/').pop(),
    path,
    is_dir: true,
});

class FsXHR {
    listeners = {};
    status = 200;
    readyState = 0;
    responseType = '';
    upload = { addEventListener() {} };
    open(_method, url) {
        this.url = url;
    }
    setRequestHeader() {}
    addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
    }
    getResponseHeader(name) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
    }
    abort() {}
    send(body) {
        const path = new URL(this.url).pathname;
        sent.push(path);
        const asked = JSON.parse(body ?? '{}').path;
        let reply = {};
        if ( path === '/whoami' ) reply = { uuid: 'u-1', username: 'alice' };
        if ( path === '/stat' ) {
            reply = Object.values(listings).flat().find((e) => e.path === asked)
                ?? dirEntry(asked ?? '/alice');
        }
        if ( path === '/fs/readdir' ) reply = listings[asked] ?? [];
        queueMicrotask(() => {
            this.responseText = JSON.stringify(reply);
            this.response = this.responseText;
            this.readyState = 4;
            for ( const fn of this.listeners.readystatechange ?? [] ) fn.call(this);
            for ( const fn of this.listeners.load ?? [] ) fn.call(this, { target: this });
        });
    }
}

const flush = async () => {
    for ( let i = 0; i < 20; i++ ) await new Promise((r) => setTimeout(r, 0));
};

const origXHR = globalThis.XMLHttpRequest;

beforeEach(() => {
    sent.length = 0;
    for ( const key of Object.keys(listings) ) delete listings[key];
    localStorage.clear();
    globalThis.XMLHttpRequest = FsXHR;
    globalThis.PUTER_QUIET = true;
    globalThis.puter_gui_enabled = true;
    window.auth_token = TOKEN;
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    delete globalThis.PUTER_QUIET;
    delete globalThis.puter_gui_enabled;
    delete window.auth_token;
    vi.restoreAllMocks();
});

/** The desktop's SDK, signed in, with its four warm folders cached. */
const bootWarm = async () => {
    history.replaceState(null, '', '/');
    vi.resetModules();
    const { puter } = await import('./index.js');
    expect(puter.env).toBe('gui');
    puter.setAuthToken(TOKEN);
    await flush();
    clearInterval(puter.guiFSCacheTimer_);
    puter.checkAndUpdateGUIFScache();
    await flush();
    sent.length = 0;
    return puter;
};

/** Requests one tick of the warm loop sends. */
const tick = async (puter) => {
    sent.length = 0;
    puter.checkAndUpdateGUIFScache();
    await flush();
    return [...sent];
};

describe('FS socket updates against the desktop cache', () => {
    it('keeps the warm folders when an unrelated file is overwritten', async () => {
        const puter = await bootWarm();
        expect(await tick(puter)).toEqual([]);

        socketHandlers['item.updated']({
            path: '/alice/AppData/app-1/state.json',
            uid: 'f-1',
            is_dir: false,
        });

        expect(await tick(puter)).toEqual([]);
    });

    it("drops an overwritten file's entry and its folder's listing", async () => {
        const file = { uid: 'f-2', name: 'notes.txt', path: '/alice/Documents/notes.txt', is_dir: false };
        listings['/alice/Documents'] = [file];
        const puter = await bootWarm();
        await puter.fs.stat({ path: file.path });
        const itemKey = puter.fsCacheKey('item', file.path);
        expect(puter._cache.get(itemKey)).toBeTruthy();

        socketHandlers['item.updated']({ ...file });

        expect(puter._cache.get(itemKey)).toBeFalsy();
        expect(await tick(puter)).toEqual(['/fs/readdir']);
    });

    it('drops the entry still cached under the old path of a renamed file', async () => {
        const before = { uid: 'f-3', name: 'a.txt', path: '/alice/Desktop/a.txt', is_dir: false };
        listings['/alice/Desktop'] = [before];
        const puter = await bootWarm();
        await puter.fs.stat({ path: before.path });
        const oldKey = puter.fsCacheKey('item', before.path);
        expect(puter._cache.get(oldKey)).toBeTruthy();

        // A rename is announced as an update that names only the new path.
        socketHandlers['item.updated']({ ...before, name: 'b.txt', path: '/alice/Desktop/b.txt' });

        expect(puter._cache.get(oldKey)).toBeFalsy();
        expect(await tick(puter)).toEqual(['/fs/readdir']);
    });

    it('starts over when a directory changes', async () => {
        const puter = await bootWarm();

        socketHandlers['item.updated'](dirEntry('/alice/Documents/project'));

        const resent = await tick(puter);
        expect(resent.filter((p) => p === '/stat')).toHaveLength(4);
        expect(resent.filter((p) => p === '/fs/readdir')).toHaveLength(4);
    });
});
