import {
    MISSING_THUMBNAIL_ATTEMPTS_REMEMBERED,
    MISSING_THUMBNAIL_BACKOFF_MS,
    MISSING_THUMBNAIL_CONCURRENCY,
    MISSING_THUMBNAIL_FAILURES_REMEMBERED,
    MISSING_THUMBNAIL_MAX_FILE_BYTES,
    MISSING_THUMBNAIL_OLD_PICTURE_MS,
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
    const read = () => {
        try {
            const stored = JSON.parse(getStorage()?.getItem(FAILURES_STORAGE_KEY) ?? '[]');
            return Array.isArray(stored) ? stored.filter(key => typeof key === 'string') : [];
        } catch {
            return [];
        }
    };
    const load = () => keys ??= new Set(read());
    return {
        has: key => load().has(key),
        add (key) {
            // Read again first: another tab may have added its own since this one loaded, and writing this tab's
            // list alone would drop them.
            keys = new Set([...read(), ...load()]);
            keys.delete(key);
            keys.add(key);
            while ( keys.size > MISSING_THUMBNAIL_FAILURES_REMEMBERED ) keys.delete(keys.values().next().value);
            try {
                getStorage()?.setItem(FAILURES_STORAGE_KEY, JSON.stringify([...keys]));
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
 * @property {(row: Element, fsentry: MissingThumbnailEntry, thumbnail: string) => void} onStored Called with the
 *     row's own entry once its thumbnail is stored.
 * @property {(row: Element, fsentry: MissingThumbnailEntry) => void} [onDropped] Called for a row that was told to
 *     keep the thumbnail it shows, when the new one isn't coming after all or is taking too long.
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
 *     observe: (row: Element, fsentry: MissingThumbnailEntry, place: MissingThumbnailPlace,
 *         options?: { showsOld?: boolean, changed?: boolean }) => boolean,
 *     reset: () => void,
 * }} `observe` takes `showsOld` for a row that shows the thumbnail of the version before, and `changed` for an entry
 *     an update just arrived for. It returns whether the row should keep showing the old thumbnail, which it should
 *     while the new one is being made.
 */
export const createMissingThumbnailFiller = ({
    download,
    store,
    generate,
    onStored,
    onDropped = () => {},
    failures = createRememberedFailures(() => undefined),
    now = () => Date.now(),
}) => {
    /**
     * @typedef {Object} Job
     * @property {Element} row
     * @property {MissingThumbnailEntry} fsentry The row's own entry, which is updated in place when the file changes.
     * @property {MissingThumbnailPlace} place
     * @property {number} readyAt
     * @property {Made} [made] A thumbnail made earlier that couldn't be stored yet.
     */
    /**
     * @typedef {Object} Made
     * @property {number} modified The version of the file the thumbnail shows.
     * @property {string} thumbnail
     */
    /** @type {Map<string, Job>} */
    const pending = new Map();
    /**
     * @typedef {Object} Download A job under way. It has no `row` once its row is gone.
     * @property {AbortController} controller
     * @property {number} modified The version being downloaded.
     * @property {boolean} unwanted The file changed, or has a thumbnail now, so nothing is stored.
     * @property {number} received Bytes of the file downloaded so far.
     * @property {Made} [made]
     * @property {Element} [row]
     * @property {MissingThumbnailEntry} fsentry
     * @property {MissingThumbnailPlace} place
     */
    /** @type {Map<string, Download>} */
    const running = new Map();
    /** @type {Set<Element>} */
    const visible = new Set();
    /** @type {Set<string>} */
    const attempted = new Set();
    /** @type {number[]} */
    const starts = [];
    let bytesLeft = MISSING_THUMBNAIL_SESSION_BYTES;
    /**
     * Rows still showing the thumbnail of the version before, and when each stops waiting for the new one.
     *
     * @type {Map<Element, { timer: ReturnType<typeof setTimeout>, until: number }>}
     */
    const keeping = new Map();
    let pausedUntil = 0;
    let timer;
    let orphanTimer;

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

    /** The row no longer waits on a new thumbnail. Returns what it was waiting with, if it was. */
    const release = (row) => {
        const kept = keeping.get(row);
        if ( kept ) {
            clearTimeout(kept.timer);
            keeping.delete(row);
        }
        return kept;
    };

    /** No thumbnail is coming for the row's file for now, so the row stops showing the old one. */
    const drop = (row, fsentry) => {
        if ( release(row) ) onDropped(row, fsentry);
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
                release(candidate.row);
                continue;
            }
            if ( !visible.has(candidate.row) || running.has(uid) ) continue;
            // The entry may have changed since it was queued: renamed, moved, or given a thumbnail by another tab.
            if ( ! wantsThumbnail(candidate.fsentry, candidate.place) ) {
                forget(uid, candidate.row);
                drop(candidate.row, candidate.fsentry);
                continue;
            }
            if ( candidate.readyAt <= time ) {
                job = candidate;
                break;
            }
            wakeAt = Math.min(wakeAt, candidate.readyAt);
        }
        return { job, wakeAt };
    };

    /**
     * Read a file's contents, counting the bytes as they arrive. The listed size can be out of date, so reading stops
     * once the file turns out to be over the size cap.
     *
     * @param {Response} response
     * @param {Download} active
     * @returns {Promise<Blob | undefined>} `undefined` for a file over the cap.
     */
    const readContents = async (response, active) => {
        if ( Number(response.headers.get('Content-Length')) > MISSING_THUMBNAIL_MAX_FILE_BYTES ) {
            await response.body?.cancel();
            return undefined;
        }
        const type = response.headers.get('Content-Type')?.split(';')[0].trim() ?? '';
        if ( ! response.body ) {
            const blob = await response.blob();
            active.received = blob.size;
            return blob.size > MISSING_THUMBNAIL_MAX_FILE_BYTES ? undefined : blob;
        }
        const reader = response.body.getReader();
        const chunks = [];
        for ( ;; ) {
            const { done, value } = await reader.read();
            if ( done ) return new Blob(chunks, { type });
            active.received += value.byteLength;
            if ( active.received > MISSING_THUMBNAIL_MAX_FILE_BYTES ) {
                await reader.cancel();
                return undefined;
            }
            chunks.push(value);
        }
    };

    /** The thumbnail a job already has for the version its file is at, so it needs no download. */
    const madeFor = job => job.made?.modified === job.fsentry.modified ? job.made : undefined;

    /** Store a made thumbnail. A refusal to wait out, or a failed connection, leaves it to be sent again. */
    const send = async (fsentry, active) => {
        let stored;
        try {
            // A thumbnail made from a version the file no longer has is refused, so it's safe to send after an abort.
            stored = await store({
                uid: fsentry.uid,
                thumbnail: active.made.thumbnail,
                expectedModified: fsentry.modified,
            });
        } catch {
            return 'throttled';
        }
        if ( stored.status === 429 ) return 'throttled';
        // The server can't use the image, and would refuse the same one made from this version again.
        if ( stored.status === 400 ) return 'failed';
        // The row's own entry, not the copy: the caller records the thumbnail on it. A row that has moved on to a
        // newer version meanwhile keeps what it shows.
        if ( ! stored.ok ) return 'done';
        if ( active.row && !active.unwanted ) {
            release(active.row);
            onStored(active.row, active.fsentry, active.made.thumbnail);
        }
        return 'stored';
    };

    const run = async (fsentry, active) => {
        if ( active.made ) return send(fsentry, active);
        let blob;
        try {
            const response = await download(fsentry.uid, active.controller.signal);
            if ( ! response.ok ) {
                // Nothing reads the error's body, and the connection is held until something does.
                response.body?.cancel().catch(() => {});
                if ( response.status === 429 ) return 'throttled';
                return response.status === 402 ? 'out_of_credit' : 'done';
            }
            blob = await readContents(response, active);
        } catch ( error ) {
            if ( active.controller.signal.aborted ) throw error;
            // The server wasn't reached, or the connection dropped. That says nothing about the file, so it waits
            // like a file the server asked to slow down for.
            return 'throttled';
        }
        if ( ! blob ) return 'failed';
        const thumbnail = await generate(new File([blob], fsentry.name, { type: fsentry.type || blob.type }));
        if ( ! thumbnail ) return 'failed';
        if ( active.unwanted ) return 'aborted';
        active.made = { modified: fsentry.modified, thumbnail };
        return send(fsentry, active);
    };

    const start = (job) => {
        const { row } = job;
        // The row's entry is updated in place when the file changes; the job keeps the version it downloads.
        const fsentry = { ...job.fsentry };
        const key = keyOf(fsentry);
        forget(fsentry.uid, row);
        remember(key);
        starts.push(now());
        const made = madeFor(job);
        // Set aside until the download ends, then settled against what arrived.
        const reserved = made ? 0 : fsentry.size;
        bytesLeft -= reserved;
        const controller = new AbortController();
        /** @type {Download} */
        const active = {
            controller,
            modified: fsentry.modified,
            unwanted: false,
            received: 0,
            made,
            row,
            fsentry: job.fsentry,
            place: job.place,
        };
        running.set(fsentry.uid, active);
        run(fsentry, active)
            .catch(() => controller.signal.aborted ? 'aborted' : 'done')
            .then((outcome) => {
                if ( outcome === 'failed' ) failures.add(key);
                // The budget is charged what was downloaded, which for a download that was cancelled or refused is
                // less than the size set aside for it.
                bytesLeft += reserved - active.received;
                // Downloads are billed to the account, so none start once it's out of credit.
                if ( outcome === 'out_of_credit' ) bytesLeft = 0;
                // A file left before its download finished, or one the server asked to wait for, is tried again.
                if ( outcome === 'aborted' || outcome === 'throttled' ) attempted.delete(key);
                if ( outcome === 'throttled' ) pausedUntil = now() + MISSING_THUMBNAIL_BACKOFF_MS;
                // Queued again for the row that has it now: after the pause, or at once for a row that came back
                // after its download was cancelled.
                if ( (outcome === 'aborted' || outcome === 'throttled') && active.row && !active.unwanted &&
                    !pending.has(fsentry.uid) ) {
                    pending.set(fsentry.uid, {
                        row: active.row,
                        fsentry: active.fsentry,
                        place: active.place,
                        readyAt: Math.max(now(), pausedUntil),
                        made: active.made,
                    });
                    observer?.observe(active.row);
                }
                // Nothing is on its way for this version, or not before a pause is over, so a row showing the old
                // thumbnail stops. A row that came back after a cancelled download is still being worked on.
                if ( outcome !== 'stored' && outcome !== 'aborted' && active.row && !active.unwanted ) {
                    drop(active.row, active.fsentry);
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
                if ( !madeFor(next.job) && next.job.fsentry.size > bytesLeft ) {
                    forget(next.job.fsentry.uid, next.job.row);
                    drop(next.job.row, next.job.fsentry);
                    continue;
                }
                start(next.job);
            }
        }
        if ( wakeAt < Infinity ) timer = setTimeout(schedule, Math.max(0, wakeAt - time));
    };

    globalThis.document?.addEventListener?.('visibilitychange', schedule);

    /** Queue a row's file, or hand the row a download already under way. Whether a thumbnail is on its way. */
    const take = (row, fsentry, place, changed) => {
        const key = keyOf(fsentry);
        const wanted = wantsThumbnail(fsentry, place);
        // A download of an older version would only be refused, and one for a file that has a thumbnail now, or
        // can't have one any more, is wasted.
        const current = running.get(fsentry.uid);
        if ( current ) {
            if ( wanted && current.modified === fsentry.modified ) {
                // Already being made: a row drawn again takes over the download its old one started, even one a list
                // row had no use for. A download that was cancelled is queued again when it ends.
                if ( current.row && current.row !== row ) release(current.row);
                Object.assign(current, { row, fsentry, place, unwanted: false });
                return true;
            }
            if ( ! current.unwanted ) {
                current.unwanted = true;
                current.controller.abort();
            }
        }
        if ( !wanted || bytesLeft <= 0 || globalThis.navigator?.connection?.saveData ||
            attempted.has(key) || failures.has(key) ) {
            // Whatever is queued is for a state the file is no longer in.
            const queued = pending.get(fsentry.uid);
            if ( queued ) forget(fsentry.uid, queued.row);
            return false;
        }
        const time = now();
        const settled = fsentry.modified * 1000 + MISSING_THUMBNAIL_SETTLE_MS;
        // An update means the file was saved just now, which `modified` rounds down by up to a second. So it waits
        // all but that second at least, even when this computer's clock is ahead and `modified` reads as long ago.
        const earliest = changed ? time + MISSING_THUMBNAIL_SETTLE_MS - 1000 : time;
        pending.set(fsentry.uid, {
            row,
            fsentry,
            place,
            readyAt: Math.min(time + MISSING_THUMBNAIL_SETTLE_MS, Math.max(earliest, settled)),
            made: pending.get(fsentry.uid)?.made,
        });
        observer.observe(row);
        // A row not on screen yet has nothing to start, and the observer's first report on it schedules. Going
        // through the queue for each row of a large folder as it's drawn would take the square of its length.
        if ( visible.has(row) ) schedule();
        return true;
    };

    return {
        observe (row, fsentry, place, { showsOld = false, changed = false } = {}) {
            if ( ! observer ) return false;
            const kept = release(row);
            const coming = take(row, fsentry, place, changed);
            // The wait counts from the first save, so a file saved over and over doesn't show an old picture for
            // as long as the saving goes on.
            const time = now();
            const until = kept?.until ?? time + MISSING_THUMBNAIL_OLD_PICTURE_MS;
            if ( coming && (showsOld || kept) && time >= pausedUntil && until > time ) {
                keeping.set(row, { until, timer: setTimeout(() => drop(row, fsentry), until - time) });
                return true;
            }
            if ( kept ) onDropped(row, fsentry);
            return false;
        },
        /**
         * Stop for rows that are gone, such as when the folder changes. A download is cancelled unless its file's row
         * is passed in again within this task, as a refresh of the folder on screen does.
         */
        reset () {
            for ( const active of running.values() ) active.row = undefined;
            clearTimeout(orphanTimer);
            orphanTimer = setTimeout(() => {
                for ( const active of running.values() ) {
                    if ( ! active.row ) active.controller.abort();
                }
            }, 0);
            pending.clear();
            visible.clear();
            for ( const { timer: keepTimer } of keeping.values() ) clearTimeout(keepTimer);
            keeping.clear();
            observer?.disconnect();
            clearTimeout(timer);
            timer = undefined;
        },
    };
};
