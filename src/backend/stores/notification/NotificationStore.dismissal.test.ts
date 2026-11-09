import { describe, expect, it, vi } from 'vitest';
import { EventClient } from '../../clients/event/EventClient.js';
import type { EventMap } from '../../clients/event/types.js';
import { NotificationStore } from './NotificationStore.js';

const setup = (row: Record<string, unknown> | null, changed = true, replica: Record<string, unknown> | null = null) => {
    const event = new EventClient({} as never);
    const emitted: EventMap['notif.acknowledged'][] = [];
    event.on('notif.acknowledged', (_key, data) => { emitted.push(data); });
    const db = {
        write: vi.fn(async () => ({ anyRowsAffected: changed })),
        pread: vi.fn(async () => row ? [row] : []),
        read: vi.fn(async (): Promise<unknown[]> => replica ? [replica] : []),
    };
    const store = new NotificationStore({}, { event, db } as never, {});
    return { store, emitted, db };
};

const appRow = {
    uid: 'one', user_id: 7, type: 'app.message', app_uid: 'app-one',
    audience: 'app-user', value: { title: 'private', data: 'private' },
};

describe('acknowledgement emission', () => {
    it('announces a committed app message dismissal without content, from a replica', async () => {
        const { store, emitted, db } = setup(null, true, appRow);
        await expect(store.markAcknowledged('one', 7)).resolves.toBe(true);
        expect(db.write.mock.calls[0][0]).toContain('`acknowledged` IS NULL');
        expect(db.read).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('`user_id` = ?'), ['one', 7]);
        expect(db.pread).not.toHaveBeenCalled();
        expect(emitted).toEqual([{ userId: 7, uid: 'one', type: 'app.message', audience: 'app-user', appUid: 'app-one' }]);
    });

    it('reads the primary when the replica has no row yet', async () => {
        const { store, emitted, db } = setup(appRow);
        await expect(store.markAcknowledged('one', 7)).resolves.toBe(true);
        expect(db.read).toHaveBeenCalledWith(expect.stringContaining('`user_id` = ?'), ['one', 7]);
        expect(db.pread).toHaveBeenCalledWith(expect.stringContaining('`user_id` = ?'), ['one', 7]);
        expect(emitted).toEqual([{ userId: 7, uid: 'one', type: 'app.message', audience: 'app-user', appUid: 'app-one' }]);
    });

    it('reads the primary when the replica read fails', async () => {
        const { store, emitted, db } = setup(appRow, true, appRow);
        db.read.mockRejectedValueOnce(new Error('unavailable'));
        await expect(store.markAcknowledged('one', 7)).resolves.toBe(true);
        expect(db.read).toHaveBeenCalledOnce();
        expect(db.pread).toHaveBeenCalledOnce();
        expect(emitted).toHaveLength(1);
    });

    it.each([
        { ...appRow, type: 'share.received' },
        { ...appRow, app_uid: null },
        null,
    ])('does not announce a row outside an app message scope: %s', async (row) => {
        const { store, emitted } = setup(row);
        await store.markAcknowledged('one', 7);
        expect(emitted).toEqual([]);
    });

    it('does not announce or read back an unchanged row', async () => {
        const { store, emitted, db } = setup(appRow, false);
        await expect(store.markAcknowledged('one', 7)).resolves.toBe(false);
        expect(db.pread).not.toHaveBeenCalled();
        expect(emitted).toEqual([]);
    });

    it('does not announce a repeat dismissal the replica still has', async () => {
        const { store, emitted, db } = setup(appRow, false, appRow);
        await expect(store.markAcknowledged('one', 7)).resolves.toBe(false);
        expect(db.pread).not.toHaveBeenCalled();
        expect(emitted).toEqual([]);
    });

    it('preserves a committed acknowledgement if the announcement read fails', async () => {
        const { store, db, emitted } = setup(appRow);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        db.pread.mockRejectedValueOnce(new Error('unavailable'));
        try {
            await expect(store.markAcknowledged('one', 7)).resolves.toBe(true);
            expect(emitted).toEqual([]);
        } finally {
            warn.mockRestore();
        }
    });

    it('does not propagate markShown', async () => {
        const { store, emitted } = setup(appRow);
        await store.markShown('one', 7);
        expect(emitted).toEqual([]);
    });
});

describe('displayed notification state query', () => {
    it('reads all named ids in one scoped query', async () => {
        const { store, db } = setup(appRow);
        await store.listByUserId(7, {
            limit: 50, uids: ['one', 'two'],
            scope: { appUid: 'app-one', audiences: ['app-user'] },
        });
        expect(db.pread).not.toHaveBeenCalled();
        expect(db.read).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining('`uid` IN (?, ?)'),
            [7, 'one', 'two', 'app-user', 'app-one', 50],
        );
        expect(db.read.mock.calls[0][0]).toContain('`user_id` = ?');
        expect(db.read.mock.calls[0][0]).toContain('`app_uid` = ?');
    });

    it('does not query an empty id set', async () => {
        const { store, db } = setup(appRow);
        expect(await store.listByUserId(7, { uids: [] })).toEqual([]);
        expect(db.read).not.toHaveBeenCalled();
    });
});
