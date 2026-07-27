import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeveloperProfile } from './getDeveloperProfile.js';

/**
 * getDeveloperProfile accepts an options object or trailing positional
 * callbacks. These pin both forms: the options used to be parsed twice, and
 * the request used to be wrapped in a second promise whose result was
 * discarded, so the outer promise never settled with the profile.
 */

const PROFILE = { username: 'dev', apps: 3 };

class FakeXHR {
    static requests = [];
    static status = 200;

    _listeners = {};

    open (method, url) {
        this.method = method;
        this.url = url;
    }

    setRequestHeader (name, value) {
        (this.requestHeaders ??= {})[name] = value;
    }

    addEventListener (type, fn) {
        (this._listeners[type] ??= []).push(fn);
    }

    getResponseHeader (name) {
        return name === 'content-type' ? 'application/json' : null;
    }

    send () {
        FakeXHR.requests.push(this);
        this.status = FakeXHR.status;
        this.responseText = JSON.stringify(PROFILE);
        queueMicrotask(() => {
            for ( const fn of this._listeners.load ?? [] ) {
                fn.call(this, { target: this });
            }
        });
    }
}

const origXHR = globalThis.XMLHttpRequest;
const origPuter = globalThis.puter;

let apps;

beforeEach(() => {
    FakeXHR.requests = [];
    FakeXHR.status = 200;
    globalThis.XMLHttpRequest = FakeXHR;
    globalThis.puter = { authToken: 'test-token', APIOrigin: 'https://api.test' };
    apps = { puter: globalThis.puter, getDeveloperProfile };
});

afterEach(() => {
    globalThis.XMLHttpRequest = origXHR;
    globalThis.puter = origPuter;
});

describe('getDeveloperProfile', () => {
    it('resolves with the profile and issues one request', async () => {
        await expect(apps.getDeveloperProfile()).resolves.toEqual(PROFILE);
        expect(FakeXHR.requests).toHaveLength(1);
        expect(FakeXHR.requests[0].url).toBe('https://api.test/get-dev-profile');
        expect(FakeXHR.requests[0].method).toBe('get');
    });

    it('calls a positional success callback', async () => {
        const success = vi.fn();
        await expect(apps.getDeveloperProfile(success)).resolves.toEqual(PROFILE);
        expect(success).toHaveBeenCalledTimes(1);
        expect(success).toHaveBeenCalledWith(PROFILE);
    });

    it('calls a success callback passed in an options object', async () => {
        const success = vi.fn();
        await expect(apps.getDeveloperProfile({ success })).resolves.toEqual(PROFILE);
        expect(success).toHaveBeenCalledWith(PROFILE);
    });

    it('rejects and calls the error callback when the request fails', async () => {
        FakeXHR.status = 500;
        const error = vi.fn();
        await expect(apps.getDeveloperProfile(undefined, error)).rejects.toBeDefined();
        expect(error).toHaveBeenCalledTimes(1);
    });
});
