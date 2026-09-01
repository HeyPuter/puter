import { describe, expect, it, vi } from 'vitest';
import resolve_shared_item from './resolveSharedItem.js';

const UID = '11111111-2222-4333-8444-555555555555';
const PATH = `/alice/${UID}/report.txt`;

/** A `stat` that answers for the calls named and throws for anything else. */
const fakeFs = (answers) => ({
    stat: vi.fn(async (opts) => {
        if ( opts.path && answers.byPath ) return answers.byPath;
        if ( opts.uid && answers.byUid ) return answers.byUid;
        throw new Error('not found');
    }),
});

describe('resolve_shared_item', () => {
    it('resolves by path when the link is still accurate', async () => {
        const fs = fakeFs({ byPath: { path: PATH, is_dir: false } });

        expect(await resolve_shared_item(fs, PATH)).toEqual({
            path: PATH,
            is_dir: false,
        });
        // One call: no need for the fallback.
        expect(fs.stat).toHaveBeenCalledTimes(1);
        expect(fs.stat).toHaveBeenCalledWith({
            path: PATH,
            consistency: 'eventual',
        });
    });

    // The owner renaming the item leaves the name segment stale, so the path
    // resolves to nothing while the uuid still names the item.
    it('falls back to the uuid when the name has gone stale', async () => {
        const renamed = { path: `/alice/${UID}/renamed.txt`, is_dir: false };
        const fs = fakeFs({ byUid: renamed });

        expect(await resolve_shared_item(fs, PATH)).toEqual(renamed);
        expect(fs.stat).toHaveBeenCalledTimes(2);
        expect(fs.stat).toHaveBeenLastCalledWith({
            uid: UID,
            consistency: 'eventual',
        });
    });

    it('gives up when neither the path nor the uuid finds it', async () => {
        const fs = fakeFs({});
        expect(await resolve_shared_item(fs, PATH)).toBeNull();
        expect(fs.stat).toHaveBeenCalledTimes(2);
    });

    // A link that isn't the shared shape is refused before any request goes
    // out, so a hand-edited one can't become a lookup.
    it('asks nothing for a path that is not a share link', async () => {
        const fs = fakeFs({ byPath: { path: '/alice/Documents/a.txt' } });

        expect(
            await resolve_shared_item(fs, '/alice/Documents/a.txt'),
        ).toBeNull();
        expect(fs.stat).not.toHaveBeenCalled();
    });
});
