// @vitest-environment jsdom
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jQuery from '../lib/jquery-3.6.1/jquery-3.6.1.min.js';

globalThis.$ = jQuery;
globalThis.jQuery = jQuery;
globalThis.html_encode = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Encodes replacements, as the real i18n() does by default.
globalThis.i18n = (key, replacements) => (Array.isArray(replacements) && replacements.length
    ? `${key}:${replacements.map(globalThis.html_encode).join(',')}`
    : key);
window.html_encode = globalThis.html_encode;
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.matchMedia = () => ({ matches: false });

const { confirmTrashingWorkers, forgetWorkers, forgetWorkersAfterMove, listWorkers, workersUnderPaths } = await import('./trashWorkers.js');

const API = { name: 'api', file_path: '/alice/Projects/api/index.js' };
const CRON = { name: 'cron', file_path: '/alice/Projects/cron.js' };
const GONE = { name: 'gone', file_path: null };

const settle = async () => {
    for ( let i = 0; i < 5; i++ ) await new Promise(resolve => setTimeout(resolve, 0));
};
// A closed dialog stays in the DOM while it fades out; the newest is on top.
const dialog = () => $('.dashboard-dialog').last();
const press = async (label) => {
    dialog().find('.dashboard-dialog-btn').filter((_, el) => $(el).text() === label).trigger('click');
    await settle();
};

const stubWorkers = (list, del = async () => true) => {
    globalThis.puter = {
        workers: {
            list: vi.fn(async () => list),
            delete: vi.fn(del),
        },
    };
    return globalThis.puter.workers;
};

beforeEach(() => {
    forgetWorkers();
    document.body.innerHTML = '';
});

afterEach(() => {
    vi.useRealTimers();
});

describe('workersUnderPaths', () => {
    it('matches a worker by its own source file', () => {
        expect(workersUnderPaths([API, CRON], ['/alice/Projects/cron.js'])).toEqual([CRON]);
    });

    it('matches every worker inside a folder without walking it', () => {
        expect(workersUnderPaths([API, CRON], ['/alice/Projects'])).toEqual([API, CRON]);
    });

    it('ignores a sibling whose name only starts with the folder name', () => {
        expect(workersUnderPaths([API], ['/alice/Projects/ap'])).toEqual([]);
        expect(workersUnderPaths([API], ['/alice/Projects/api/index'])).toEqual([]);
    });

    it('compares paths ignoring case', () => {
        expect(workersUnderPaths([API], ['/alice/projects/API'])).toEqual([API]);
    });

    it('skips workers whose source file no longer exists', () => {
        expect(workersUnderPaths([GONE], ['/alice'])).toEqual([]);
    });
});

describe('listWorkers', () => {
    it('lists once for calls within the cache window', async () => {
        const workers = stubWorkers([API]);
        await listWorkers();
        await listWorkers();
        expect(workers.list).toHaveBeenCalledTimes(1);
    });

    it('lists again once the cache expires', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const workers = stubWorkers([API]);
        await listWorkers();
        vi.setSystemTime(Date.now() + 61 * 1000);
        await listWorkers();
        expect(workers.list).toHaveBeenCalledTimes(2);
    });

    it('lists again after forgetWorkers()', async () => {
        const workers = stubWorkers([API]);
        await listWorkers();
        forgetWorkers();
        await listWorkers();
        expect(workers.list).toHaveBeenCalledTimes(2);
    });

    it('lists again after an item moves somewhere other than the Trash', async () => {
        window.trash_path = '/alice/Trash';
        const workers = stubWorkers([API]);
        await listWorkers();
        forgetWorkersAfterMove('/alice/Archive/Projects');
        await listWorkers();
        expect(workers.list).toHaveBeenCalledTimes(2);
    });

    it('keeps the listing when an item moves into the Trash', async () => {
        window.trash_path = '/alice/Trash';
        const workers = stubWorkers([API]);
        await listWorkers();
        forgetWorkersAfterMove('/alice/Trash/2f1c-notes.txt');
        await listWorkers();
        expect(workers.list).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed listing', async () => {
        const workers = stubWorkers([API]);
        workers.list.mockRejectedValueOnce(new Error('offline'));
        await expect(listWorkers()).rejects.toThrow('offline');
        await expect(listWorkers()).resolves.toEqual([API]);
    });
});

describe('confirmTrashingWorkers', () => {
    it('goes ahead without asking when nothing trashed holds a worker', async () => {
        const workers = stubWorkers([API]);
        await expect(confirmTrashingWorkers(['/alice/Documents'])).resolves.toBe(true);
        expect(dialog().length).toBe(0);
        expect(workers.delete).not.toHaveBeenCalled();
    });

    it('goes ahead without asking when the worker list is unavailable', async () => {
        const workers = stubWorkers([API]);
        workers.list.mockRejectedValueOnce(new Error('offline'));
        await expect(confirmTrashingWorkers(['/alice/Projects'])).resolves.toBe(true);
        expect(dialog().length).toBe(0);
    });

    it('names the worker and deletes it once the user confirms', async () => {
        const workers = stubWorkers([API, CRON]);
        const result = confirmTrashingWorkers(['/alice/Projects/cron.js']);
        await settle();

        expect(dialog().find('.dashboard-dialog-title').text()).toBe('delete_worker_title');
        expect(dialog().find('.dashboard-dialog-message').text()).toBe('trash_deletes_worker:cron');
        await press('delete');

        await expect(result).resolves.toBe(true);
        expect(workers.delete).toHaveBeenCalledTimes(1);
        expect(workers.delete).toHaveBeenCalledWith('cron');
    });

    it('lists every worker inside a trashed folder', async () => {
        const workers = stubWorkers([API, CRON]);
        const result = confirmTrashingWorkers(['/alice/Projects']);
        await settle();

        expect(dialog().find('.dashboard-dialog-title').text()).toBe('delete_workers_title');
        expect(dialog().find('li').map((_, el) => $(el).text()).get()).toEqual(['api', 'cron']);
        await press('delete');

        await expect(result).resolves.toBe(true);
        expect(workers.delete.mock.calls.map(call => call[0]).sort()).toEqual(['api', 'cron']);
    });

    it('escapes worker names in the message', async () => {
        stubWorkers([{ name: '<b>x</b>', file_path: '/alice/x.js' }]);
        const result = confirmTrashingWorkers(['/alice']);
        await settle();
        expect(dialog().find('.dashboard-dialog-message b').length).toBe(0);
        await press('cancel');
        await result;
    });

    it('keeps the items and the worker when the user cancels', async () => {
        const workers = stubWorkers([CRON]);
        const result = confirmTrashingWorkers(['/alice/Projects/cron.js']);
        await settle();
        await press('cancel');

        await expect(result).resolves.toBe(false);
        expect(workers.delete).not.toHaveBeenCalled();
    });

    it('stops and names the worker that could not be deleted', async () => {
        const workers = stubWorkers([API, CRON], async (name) => {
            if ( name === 'cron' ) throw { message: 'Permission denied', code: 'forbidden' };
            return true;
        });
        const result = confirmTrashingWorkers(['/alice/Projects']);
        await settle();
        await press('delete');

        expect(dialog().find('.dashboard-dialog-title').text()).toBe('trash_worker_delete_failed_title');
        expect(dialog().find('.dashboard-dialog-message p').map((_, el) => $(el).text()).get())
            .toEqual(['trash_worker_delete_failed:cron', 'Permission denied']);
        await press('ok');
        await expect(result).resolves.toBe(false);
        expect(workers.delete).toHaveBeenCalledTimes(2);
    });

    it('goes ahead when a worker was already deleted elsewhere', async () => {
        const workers = stubWorkers([API, CRON], async (name) => {
            if ( name === 'cron' ) throw { message: 'Worker not found', code: 'not_found' };
            return true;
        });
        const result = confirmTrashingWorkers(['/alice/Projects']);
        await settle();
        await press('delete');

        await expect(result).resolves.toBe(true);
        expect(workers.delete).toHaveBeenCalledTimes(2);
        expect($('.dashboard-dialog-error').length).toBe(0);
    });

    it('lists afresh after deleting, so a deleted worker is not asked about again', async () => {
        const workers = stubWorkers([CRON]);
        const result = confirmTrashingWorkers(['/alice/Projects/cron.js']);
        await settle();
        await press('delete');
        await result;

        workers.list.mockResolvedValueOnce([]);
        await expect(confirmTrashingWorkers(['/alice/Projects/cron.js'])).resolves.toBe(true);
        expect(workers.list).toHaveBeenCalledTimes(2);
    });
});
