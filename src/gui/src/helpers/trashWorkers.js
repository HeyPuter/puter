/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import UIDashboardDialog from '../UI/Dashboard/UIDashboardDialog.js';

/** @typedef {{ name: string, file_path?: string | null }} Worker */

/** Long enough that trashing several things in a row costs one listing. */
const WORKER_LIST_TTL = 60 * 1000;

/** How long a trash waits for the listing before going ahead without it. */
const WORKER_LIST_WAIT = 10 * 1000;

/** @type {{ at: number, promise: Promise<Worker[]> } | null} */
let workerListCache = null;

/** Path sets whose trashing is waiting on the listing, the user, or a delete. */
const pendingTrashes = new Set();

/**
 * The user's workers, from a short-lived cache. A listing that failed isn't
 * cached, so the next call tries again.
 *
 * @returns {Promise<Worker[]>}
 */
export const listWorkers = async () => {
    if ( workerListCache && Date.now() - workerListCache.at < WORKER_LIST_TTL ) {
        return workerListCache.promise;
    }
    const entry = {
        at: Date.now(),
        promise: puter.workers.list().then(list => (Array.isArray(list) ? list : [])),
    };
    workerListCache = entry;
    entry.promise.catch(() => {
        if ( workerListCache === entry ) workerListCache = null;
    });
    return entry.promise;
};

/** Drops the cached listing: a worker was created or deleted, or a path changed. */
export const forgetWorkers = () => {
    workerListCache = null;
};

/**
 * Drops the cached listing after an item moved to `path`. A move into the
 * Trash keeps it: the workers it would affect are deleted before the move.
 *
 * @param {string | undefined} path
 */
export const forgetWorkersAfterMove = (path) => {
    if ( path?.startsWith(`${window.trash_path}/`) ) return;
    forgetWorkers();
};

/**
 * The workers whose source file is one of `paths` or inside one of them.
 * Matches by path prefix, so a folder isn't walked. Paths compare ignoring
 * case, like the rest of the GUI.
 *
 * @param {Worker[]} workers
 * @param {string[]} paths
 * @returns {Worker[]}
 */
export const workersUnderPaths = (workers, paths) => {
    const roots = paths.filter(Boolean).map(p => p.toLowerCase());
    if ( roots.length === 0 ) return [];
    return workers.filter((worker) => {
        const file = worker?.file_path?.toLowerCase();
        if ( ! file ) return false;
        return roots.some(root => file === root || file.startsWith(`${root}/`));
    });
};

/**
 * Before `paths` go to the Trash: if any of them is, or holds, a worker's
 * source file, asks the user and deletes those workers. Resolves `true` when
 * trashing may go ahead. A listing that fails or stalls doesn't block
 * trashing. A repeat for the same paths while the first is pending (a second
 * Delete press) resolves `false`: the first call trashes them.
 *
 * @param {string[]} paths
 * @returns {Promise<boolean>}
 */
export const confirmTrashingWorkers = async (paths) => {
    const key = [...paths].sort().join('\n');
    if ( pendingTrashes.has(key) ) return false;
    pendingTrashes.add(key);
    try {
        return await askAndDeleteWorkers(paths);
    } finally {
        pendingTrashes.delete(key);
    }
};

/**
 * The check itself, run once per pending path set.
 *
 * @param {string[]} paths
 * @returns {Promise<boolean>}
 */
const askAndDeleteWorkers = async (paths) => {
    let workers;
    let timer;
    try {
        // A stalled listing would hold the trash with nothing on screen.
        const deadline = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('worker listing timed out')), WORKER_LIST_WAIT);
        });
        workers = workersUnderPaths(await Promise.race([listWorkers(), deadline]), paths);
    } catch {
        return true;
    } finally {
        clearTimeout(timer);
    }
    if ( workers.length === 0 ) return true;

    const single = workers.length === 1;
    const message = single
        ? `<p>${i18n('trash_deletes_worker', [workers[0].name])}</p>`
        : `<p>${i18n('trash_deletes_workers')}</p><ul>${workers.map(w => `<li><strong>${html_encode(w.name)}</strong></li>`).join('')}</ul>`;
    const confirmed = await UIDashboardDialog({
        title: i18n(single ? 'delete_worker_title' : 'delete_workers_title', [], false),
        message,
        tone: 'danger',
        // Any window can trash, and phones stack every window over a body overlay.
        aboveWindows: true,
        buttons: [
            { label: i18n('cancel', [], false), value: false, type: 'quiet' },
            { label: i18n('delete', [], false), value: true, type: 'danger' },
        ],
    });
    if ( confirmed !== true ) return false;

    const results = await Promise.allSettled(workers.map(w => puter.workers.delete(w.name)));
    forgetWorkers();
    // A worker deleted elsewhere since the list was read is already gone.
    const failed = results.findIndex(r => r.status === 'rejected' && r.reason?.code !== 'not_found');
    if ( failed !== -1 ) {
        const reason = results[failed].reason;
        await UIDashboardDialog({
            title: i18n('trash_worker_delete_failed_title', [], false),
            message: `<p>${i18n('trash_worker_delete_failed', [workers[failed].name])}</p>`
                + `<p>${html_encode(reason?.message ?? i18n('error_unknown_cause', [], false))}</p>`,
            tone: 'error',
            aboveWindows: true,
        });
        return false;
    }
    return true;
};
