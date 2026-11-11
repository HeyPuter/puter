// The SDK's own puter.fs.unshare, answering its request with a canned /share/revoke body.
import unshare from '../../../puter-js/src/modules/FileSystem/operations/unshare.js';

const cannedXHR = (answer) => class {
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
    send (request) {
        const body = typeof answer === 'function' ? answer(JSON.parse(request)) : answer;
        queueMicrotask(() => {
            this.responseText = JSON.stringify(body);
            for ( const fn of this._listeners.load ?? [] ) fn.call(this, { target: this });
        });
    }
};

/**
 * @param {Record<string, unknown> | ((request: { items: { path?: string }[] }) => Record<string, unknown>)} answer
 * what /share/revoke answers with, or how it answers one request
 * @returns {(...args: unknown[]) => Promise<unknown>}
 */
export const unshareAnswering = (answer) => {
    const CannedXHR = cannedXHR(answer);
    const fs = { APIOrigin: 'https://api.test', authToken: 'test-token' };
    // XMLHttpRequest is swapped for the length of one call only.
    return async (...args) => {
        const original = globalThis.XMLHttpRequest;
        globalThis.XMLHttpRequest = CannedXHR;
        try {
            return await unshare.call(fs, ...args);
        } finally {
            globalThis.XMLHttpRequest = original;
        }
    };
};

/** Every pair refused, as the backend reports leaving a share held through a team. */
export const allRefused = {
    status: 'aborted',
    revoked: 0,
    results: [{ recipient: 'alice', status: 'error', code: 'team_share', message: 'Held through a team' }],
};

/**
 * A /share/revoke answer for `request` that refuses the items `refuses` picks.
 *
 * @param {{ items: { path?: string }[] }} request
 * @param {(path: string) => boolean} refuses
 * @param {{ code: string, message: string }} error
 */
export const refusing = (request, refuses, error) => {
    const results = request.items.map(({ path }) => (refuses(path)
        ? { recipient: 'bob', path, status: 'error', ...error }
        : { recipient: 'bob', path, status: 'success' }));
    const refused = results.filter((result) => result.status === 'error').length;
    return {
        status: refused === 0 ? 'success' : (refused === results.length ? 'aborted' : 'mixed'),
        revoked: results.length - refused,
        results,
    };
};

/** One pair refused because the recipient or the item is gone, which unshare resolves. */
export const goneRefused = {
    status: 'aborted',
    revoked: 0,
    results: [{ recipient: 'alice', path: '/gone', status: 'error', code: 'subject_does_not_exist', message: 'Subject does not exist' }],
};
