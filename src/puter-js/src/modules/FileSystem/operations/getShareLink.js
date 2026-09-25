import { parseOperationArgs } from './scaffold.js';
import stat from './stat.js';

/** @typedef {import('../types.js').GetShareLinkOptions} GetShareLinkOptions */

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * @typedef {{
 *   (options: GetShareLinkOptions): Promise<string>,
 *   (
 *     item: string,
 *     appName?: string,
 *     success?: (value: string) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<string>,
 * }} GetShareLinkOperation
 */

/**
 * Builds the link that opens a file in an app on Puter:
 * `<origin>/app/<appName>?file=<uid>`. `item` is a path (relative paths
 * resolve against the app's root directory) or a uid; `appName` defaults to
 * the calling app.
 *
 * The link grants nothing by itself. Whoever follows it must already be able
 * to reach the file — as its owner, as someone it was shared with, or as
 * anyone once the file is open to anyone with the link — and is asked before
 * the app is handed the file.
 *
 * @this {import('../index.js').PuterJSFileSystemModule}
 * @param {...unknown} args
 * @returns {Promise<string>}
 */
const getShareLinkImpl = async function (...args) {
    const options = parseOperationArgs(args, ['item', 'appName']);

    /** @param {{ message: string, code: string }} reason */
    const fail = (reason) => {
        if ( typeof options.error === 'function' ) options.error(reason);
        throw reason;
    };

    const item = typeof options.item === 'string' ? options.item : undefined;
    const uid = options.uid !== undefined
        ? String(options.uid)
        : (item !== undefined && UUID.test(item) ? item : undefined);
    const path = uid === undefined ? (options.path ?? item) : undefined;
    if ( uid === undefined && (typeof path !== 'string' || path === '') ) {
        return fail({ message: 'getShareLink() needs a path or a uid.', code: 'field_missing' });
    }

    const appName = options.appName ?? this.puter.appName;
    if ( typeof appName !== 'string' || appName === '' ) {
        return fail({
            message: 'getShareLink() needs the name of the app to open the file with; pass `appName`.',
            code: 'app_name_required',
        });
    }

    let entry;
    try {
        entry = await stat.call(this, uid !== undefined ? { uid } : { path });
    } catch (e) {
        if ( typeof options.error === 'function' ) options.error(e);
        throw e;
    }
    if ( entry.is_dir ) {
        return fail({
            message: 'getShareLink() needs a file; a directory cannot be opened with an app.',
            code: 'not_a_file',
        });
    }

    const origin = String(this.puter.defaultGUIOrigin).replace(/\/+$/, '');
    const link = `${origin}/app/${encodeURIComponent(appName)}?file=${encodeURIComponent(entry.uid)}`;
    if ( typeof options.success === 'function' ) options.success(link);
    return link;
};

const getShareLink = /** @type {GetShareLinkOperation} */ (getShareLinkImpl);

export default getShareLink;
