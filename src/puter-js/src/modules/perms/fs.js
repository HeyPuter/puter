import path from 'path-browserify';
import { invalidArgument } from './lib/validate.js';

/**
 * The uuids (v1-8, nil, max) the grant route accepts as an `fs:` uid. Narrower
 * than the filesystem module's `looksLikeUid`, which takes any version.
 */
const FS_UID_SHAPE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;

/**
 * The entry an `'fs'` request names: a uid as given, or a path made absolute
 * and normalized, with a leading `~` standing for the user's home folder.
 *
 * @param {Record<string, unknown>} details
 * @param {() => Promise<Record<string, any>>} whoami
 * @returns {Promise<string>}
 */
export async function fsTargetOf (details, whoami) {
    const { path: target, uid } = details;
    if ( target === undefined && uid === undefined ) {
        throw invalidArgument('pass `path` or `uid`');
    }
    if ( target !== undefined && uid !== undefined ) {
        throw invalidArgument('pass `path` or `uid`, not both');
    }
    if ( uid !== undefined ) {
        if ( typeof uid !== 'string' || ! FS_UID_SHAPE.test(uid) ) {
            throw invalidArgument('`uid` must be the uid of a file or folder');
        }
        return uid;
    }
    if (
        typeof target !== 'string'
        || ! (target.startsWith('/') || target === '~' || target.startsWith('~/'))
    ) {
        throw invalidArgument('`path` must start with `/` or `~/`');
    }
    const absolute = target.startsWith('~')
        ? `/${(await whoami()).username}${target.slice(1)}`
        : target;
    const normalized = path.normalize(absolute);
    return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}
