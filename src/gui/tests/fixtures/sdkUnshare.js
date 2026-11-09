// The SDK's own puter.fs.unshare, answering every request with a canned /share/revoke body.
import unshare from '../../../puter-js/src/modules/FileSystem/operations/unshare.js';

class CannedXHR {
    static body = null;
    _listeners = {};
    status = 200;
    open () {}
    setRequestHeader () {}
    getResponseHeader (name) {
        return name.toLowerCase() === 'content-type' ? 'application/json' : null;
    }
    addEventListener (type, fn) {
        (this._listeners[type] ??= []).push(fn);
    }
    send () {
        queueMicrotask(() => {
            this.responseText = JSON.stringify(CannedXHR.body);
            for ( const fn of this._listeners.load ?? [] ) fn.call(this, { target: this });
        });
    }
}

/**
 * @param {Record<string, unknown>} body what /share/revoke answers with
 * @returns {(...args: unknown[]) => Promise<unknown>}
 */
export const unshareAnswering = (body) => {
    CannedXHR.body = body;
    globalThis.XMLHttpRequest = CannedXHR;
    const fs = { APIOrigin: 'https://api.test', authToken: 'test-token' };
    return (...args) => unshare.call(fs, ...args);
};

/** Every pair refused, as the backend reports leaving a share held through a team. */
export const allRefused = {
    status: 'aborted',
    revoked: 0,
    results: [{ recipient: 'alice', status: 'error', code: 'team_share', message: 'Held through a team' }],
};
