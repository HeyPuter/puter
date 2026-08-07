import { defineOperation, firstDefined } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').SignResult} SignResult */

/**
 * Signs one or more filesystem entries for an app, producing the access URLs
 * and token that let the app open them. Resolves with `{ token, items }`,
 * where `items` is a single object when a single item was signed and an array
 * otherwise.
 *
 * @type {(
 *   appUid: string,
 *   items: unknown | unknown[],
 *   success?: (value: SignResult) => void,
 *   error?: (reason: unknown) => void,
 * ) => Promise<SignResult>}
 */
const sign = defineOperation({
    positional: ['appUid', 'items'],
    request (options) {
        // A single item is wrapped so the request always carries an array;
        // one signature is unwrapped again below.
        const items = Array.isArray(options.items) ? options.items : [options.items];
        const single = items.length === 1;

        return {
            endpoint: '/sign',
            body: {
                app_uid: firstDefined(options, 'appUid', 'app_uid'),
                items,
            },
            transform: (/** @type {{ token: string, signatures: Record<string, unknown>[] }} */ response) => ({
                token: response.token,
                items: single
                    ? { ...response.signatures[0] }
                    : response.signatures.map((signature) => ({ ...signature })),
            }),
        };
    },
});

export default sign;
