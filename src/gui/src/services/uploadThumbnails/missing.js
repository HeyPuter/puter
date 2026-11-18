import {
    MISSING_THUMBNAIL_ATTEMPTS_REMEMBERED,
    MISSING_THUMBNAIL_BACKOFF_MS,
    MISSING_THUMBNAIL_CONCURRENCY,
    MISSING_THUMBNAIL_FAILURES_REMEMBERED,
    MISSING_THUMBNAIL_MAX_FILE_BYTES,
    MISSING_THUMBNAIL_PER_MINUTE,
    MISSING_THUMBNAIL_SESSION_BYTES,
    MISSING_THUMBNAIL_SETTLE_MS,
} from './config.js';
import { canMakeThumbnail, isPageDocument } from './kinds.js';

/**
 * @typedef {Object} MissingThumbnailEntry The fields of a listed entry the filler reads.
 * @property {string} uid
 * @property {string} name
 * @property {string} path
 * @property {string} [type]
 * @property {number} size
 * @property {number} modified Seconds since the epoch.
 * @property {string | null} [thumbnail]
 * @property {boolean} [is_dir]
 * @property {boolean | number} [is_shortcut]
 * @property {boolean} [immutable]
 */

/**
 * @typedef {Object} MissingThumbnailPlace Where the row is shown.
 * @property {boolean} listRow A list row shows a document's type icon rather than its thumbnail.
 * @property {string} homePath The user's home folder. Only files inside it are filled in.
 * @property {string[]} excludedPaths Folders inside the home folder whose files are left alone.
 */

/**
 * Whether the dashboard should make a thumbnail for an entry: a file the user owns, of a kind the generator reads,
 * that has none, and whose row would show one.
 *
 * @param {MissingThumbnailEntry} fsentry
 * @param {MissingThumbnailPlace} place
 * @returns {boolean}
 */
export const wantsThumbnail = (fsentry, { listRow, homePath, excludedPaths }) => {
    if ( !fsentry || fsentry.is_dir || fsentry.is_shortcut || fsentry.immutable || fsentry.thumbnail ) return false;
    if ( !(fsentry.size > 0) || fsentry.size > MISSING_THUMBNAIL_MAX_FILE_BYTES ) return false;
    const path = fsentry.path ?? '';
    if ( !homePath || !path.startsWith(`${homePath}/`) ) return false;
    if ( excludedPaths.some(excluded => excluded && path.startsWith(`${excluded}/`)) ) return false;
    if ( listRow && isPageDocument(fsentry.name) ) return false;
    return canMakeThumbnail(fsentry.name, fsentry.type ?? '');
};

const FAILURES_STORAGE_KEY = 'missing_thumbnail_failures';

/**
 * @typedef {Object} RememberedFailures
 * @property {(key: string) => boolean} has
 * @property {(key: string) => void} add
 */

/**
 * The file versions that gave no thumbnail, kept in `storage` so a later page load doesn't download them again. The
 * oldest are forgotten first. Without working storage, they're kept for this page load only.
 *
 * @param {() => Pick<Storage, 'getItem' | 'setItem'> | undefined} getStorage Reading `localStorage` can throw.
 * @returns {RememberedFailures}
 */
export const createRememberedFailures = (getStorage) => {
    /** @type {Set<string> | undefined} */
    let keys;
    const load = () => {
        if ( keys ) return keys;
        try {
            const stored = JSON.parse(getStorage()?.getItem(FAILURES_STORAGE_KEY) ?? '[]');
            keys = new Set(Array.isArray(stored) ? stored.filter(key => typeof key === 'string') : []);
        } catch {
            keys = new Set();
        }
        return keys;
    };
    return {
        has: key => load().has(key),
        add (key) {
            const loaded = load();
            loaded.delete(key);
            loaded.add(key);
            while ( loaded.size > MISSING_THUMBNAIL_FAILURES_REMEMBERED ) loaded.delete(loaded.values().next().value);
            try {
                getStorage()?.setItem(FAILURES_STORAGE_KEY, JSON.stringify([...loaded]));
            } catch {
                // Full or blocked storage only means a later page load tries the file again.
            }
        },
    };
};

/**
 * @typedef {Object} MissingThumbnailDeps
 * @property {(uid: string, signal: AbortSignal) => Promise<Response>} download The file's contents.
 * @property {(body: { uid: string, thumbnail: string, expectedModified: number }) => Promise<Response>} store
 *     Saves the thumbnail, unless the file changed since `expectedModified`.
 * @property {(file: File) => Promise<string | undefined>} generate A data URL, or `undefined` for none.
 * @property {(row: Element, fsentry: MissingThumbnailEntry, thumbnail: string) => void} onStored
 * @property {RememberedFailures} [failures] Versions that gave no thumbnail before, which are skipped.
 * @property {() => number} [now]
 */

/**
 * Make thumbnails for files that have none, such as ones an app wrote or edited, as their rows come into view. Files
 * are downloaded a few at a time, newest version only. Each version is tried once per page load, and one that gives
 * no thumbnail isn't tried again.
 *
 * @param {MissingThumbnailDeps} deps
 * @returns {{
 *     observe: (row: Element, fsentry: MissingThumbnailEntry, place: MissingThumbnailPlace) => void,
 *     reset: () => void,
 * }}
 */
export const createMissingThumbnailFiller = ({
    download,
    store,
    generate,
    onStored,
    failures = createRememberedFailures(() => undefined),
    now = () => Date.now(),
}) => {
    /** @type {Map<string, { row: Element, fsentry: MissingThumbnailEntry, readyAt: number }>} */
    const pending = new Map();
    /** @type {Map<string, { controller: AbortController, modified: number }>} */
    const running = new Map();
    /** @type {Set<Element>} */
    const visible = new Set();
    /** @type {Set<string>} */
    const attempted = new Set();
    /** @type {number[]} */
    const starts = [];
    let bytesLeft = MISSING_THUMBNAIL_SESSION_BYTES;
    let pausedUntil = 0;
    let timer;

    const observer = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            for ( const entry of entries ) {
                if ( entry.isIntersecting ) visible.add(entry.target);
                else visible.delete(entry.target);
            }
            schedule();
        }, { rootMargin: '200px' })
        : undefined;

    const keyOf = fsentry => `${fsentry.uid}:${fsentry.modified}`;

    const forget = (uid, row) => {
        pending.delete(uid);
        visible.delete(row);
        observer?.unobserve(row);
    };

    const remember = (key) => {
        attempted.add(key);
        if ( attempted.size > MISSING_THUMBNAIL_ATTEMPTS_REMEMBERED ) {
            attempted.delete(attempted.values().next().value);
        }
    };

    /** The next job that can start now, or when the soonest one can. */
    const nextJob = (time) => {
        let job;
        let wakeAt = Infinity;
        for ( const [uid, candidate] of pending ) {
            if ( ! candidate.row.isConnected ) {
                forget(uid, candidate.row);
                continue;
            }
            if ( !visible.has(candidate.row) || running.has(uid) ) continue;
            if ( candidate.readyAt <= time ) {
                job = candidate;
                break;
            }
            wakeAt = Math.min(wakeAt, candidate.readyAt);
        }
        return { job, wakeAt };
    };

    const run = async ({ row, fsentry }, signal) => {
        const response = await download(fsentry.uid, signal);
        if ( response.status === 429 ) return 'throttled';
        if ( response.status === 402 ) return 'out_of_credit';
        if ( ! response.ok ) return 'done';
        const blob = await response.blob();
        if ( blob.size > MISSING_THUMBNAIL_MAX_FILE_BYTES ) return 'failed';
        const thumbnail = await generate(new File([blob], fsentry.name, { type: fsentry.type || blob.type }));
        if ( ! thumbnail ) return 'failed';
        // A thumbnail made from a version the file no longer has is refused, so it's safe to send after an abort.
        const stored = await store({ uid: fsentry.uid, thumbnail, expectedModified: fsentry.modified });
        if ( stored.status === 429 ) return 'throttled';
        if ( stored.ok ) onStored(row, fsentry, thumbnail);
        return 'done';
    };

    const start = (job) => {
        const { row } = job;
        // The row's entry is updated in place when the file changes; the job keeps the version it downloads.
        const fsentry = { ...job.fsentry };
        const key = keyOf(fsentry);
        forget(fsentry.uid, row);
        remember(key);
        starts.push(now());
        bytesLeft -= fsentry.size;
        const controller = new AbortController();
        running.set(fsentry.uid, { controller, modified: fsentry.modified });
        run({ row, fsentry }, controller.signal)
            .catch(() => controller.signal.aborted ? 'aborted' : 'done')
            .then((outcome) => {
                if ( outcome === 'failed' ) failures.add(key);
                // Downloads are billed to the account, so none start once it's out of credit.
                if ( outcome === 'out_of_credit' ) bytesLeft = 0;
                // A file left before its download finished, or one the server asked to wait for, is tried again.
                if ( outcome === 'aborted' || outcome === 'throttled' ) {
                    attempted.delete(key);
                    bytesLeft += fsentry.size;
                }
                if ( outcome === 'throttled' ) {
                    pausedUntil = now() + MISSING_THUMBNAIL_BACKOFF_MS;
                    if ( ! pending.has(fsentry.uid) ) {
                        pending.set(fsentry.uid, { row, fsentry: job.fsentry, readyAt: pausedUntil });
                        observer?.observe(row);
                    }
                }
            })
            .finally(() => {
                if ( running.get(fsentry.uid)?.controller === controller ) running.delete(fsentry.uid);
                schedule();
            });
    };

    const schedule = () => {
        clearTimeout(timer);
        timer = undefined;
        if ( globalThis.document?.hidden || !pending.size ) return;
        const time = now();
        let wakeAt = Infinity;
        if ( time < pausedUntil ) {
            wakeAt = pausedUntil;
        } else {
            while ( running.size < MISSING_THUMBNAIL_CONCURRENCY ) {
                while ( starts.length && starts[0] <= time - 60_000 ) starts.shift();
                if ( starts.length >= MISSING_THUMBNAIL_PER_MINUTE ) {
                    wakeAt = starts[0] + 60_000;
                    break;
                }
                const next = nextJob(time);
                if ( ! next.job ) {
                    wakeAt = next.wakeAt;
                    break;
                }
                // Over the download budget, the rest of the page load goes without.
                if ( next.job.fsentry.size > bytesLeft ) {
                    forget(next.job.fsentry.uid, next.job.row);
                    continue;
                }
                start(next.job);
            }
        }
        if ( wakeAt < Infinity ) timer = setTimeout(schedule, Math.max(0, wakeAt - time));
    };

    globalThis.document?.addEventListener?.('visibilitychange', schedule);

    return {
        observe (row, fsentry, place) {
            if ( !observer || bytesLeft <= 0 || globalThis.navigator?.connection?.saveData ) return;
            const key = keyOf(fsentry);
            if ( !wantsThumbnail(fsentry, place) || attempted.has(key) || failures.has(key) ) return;
            // A download of an older version would only be refused.
            const current = running.get(fsentry.uid);
            if ( current && current.modified !== fsentry.modified ) current.controller.abort();
            const time = now();
            const settled = fsentry.modified * 1000 + MISSING_THUMBNAIL_SETTLE_MS;
            pending.set(fsentry.uid, {
                row,
                fsentry,
                readyAt: Math.min(time + MISSING_THUMBNAIL_SETTLE_MS, Math.max(time, settled)),
            });
            observer.observe(row);
            schedule();
        },
        /** Stop for rows that are gone, such as when the folder changes. */
        reset () {
            for ( const { controller } of running.values() ) controller.abort();
            pending.clear();
            visible.clear();
            observer?.disconnect();
            clearTimeout(timer);
            timer = undefined;
        },
    };
};
