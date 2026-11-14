import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';

const SMALL = 'hello from a small file';
// Two warm-up runs and seven recorded ones, with spares.
const RUNS = 12;
const MUTATED = ['overwrite', 'rename', 'move', 'trash'];

const fileBody = (path: string, overwrite = false) => ({
    fileMetadata: {
        path,
        size: SMALL.length,
        contentType: 'text/plain',
        overwrite,
    },
    fileContent: SMALL,
});

describe('fs', () => {
    const home = () => `/${env.users.user.username}`;
    const bench = () => `${home()}/Documents/bench`;

    const seed = async (env: BenchEnv) => {
        const { fs } = env.server.services;
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const userId = owner!.id;
        const write = (path: string) => {
            const content = Buffer.from(SMALL);
            return fs.write(userId, {
                fileMetadata: {
                    path,
                    size: content.byteLength,
                    contentType: 'text/plain',
                },
                fileContent: content,
            });
        };

        await fs.mkdir(userId, { path: bench() });
        const dirs = [
            'hundred',
            'writes',
            'dirs',
            'moved',
            'copies',
            'batches',
            ...MUTATED,
        ];
        for (const dir of dirs) {
            await fs.mkdir(userId, { path: `${bench()}/${dir}` });
        }
        const numbered = (dir: string, count: number) =>
            Array.from(
                { length: count },
                (_, i) => `${bench()}/${dir}/file-${i}.txt`,
            );
        const files = [
            `${bench()}/small.txt`,
            ...numbered('hundred', 100),
            // A scenario that changes a file takes a fresh one each run, so
            // no run reads what the run before it just wrote.
            ...MUTATED.flatMap((dir) => numbered(dir, RUNS)),
        ];
        for (const path of files) await write(path);
    };

    const env = useBenchEnv({ seed });
    let run = 0;

    env.scenario('stat a file', async () => {
        await env.request('/fs/stat', {
            json: { path: `${bench()}/small.txt` },
        });
    });

    env.scenario('stat a directory', async () => {
        await env.request('/fs/stat', {
            json: { path: `${home()}/Documents` },
        });
    });

    env.scenario('list a home directory', async () => {
        await env.request('/fs/readdir', { json: { path: home() } });
    });

    env.scenario('list a directory with 100 files', async () => {
        await env.request('/fs/readdir', {
            json: { path: `${bench()}/hundred` },
        });
    });

    env.scenario('read a small file', async () => {
        const path = encodeURIComponent(`${bench()}/small.txt`);
        await env.request(`/fs/read?path=${path}`);
    });

    env.scenario('write a new small file', async () => {
        await env.request('/fs/write', {
            json: fileBody(`${bench()}/writes/new-${run++}.txt`),
        });
    });

    let overwrites = 0;
    env.scenario('overwrite an existing file', async () => {
        await env.request('/fs/write', {
            json: fileBody(
                `${bench()}/overwrite/file-${overwrites++}.txt`,
                true,
            ),
        });
    });

    env.scenario('create a directory', async () => {
        await env.request('/fs/mkdir', {
            json: { path: `${bench()}/dirs/dir-${run++}` },
        });
    });

    let renames = 0;
    env.scenario('rename a file', async () => {
        await env.request('/fs/rename', {
            json: {
                path: `${bench()}/rename/file-${renames}.txt`,
                new_name: `renamed-${renames++}.txt`,
            },
        });
    });

    let moves = 0;
    env.scenario('move a file to another directory', async () => {
        await env.request('/fs/move', {
            json: {
                source: `${bench()}/move/file-${moves++}.txt`,
                destination: `${bench()}/moved`,
            },
        });
    });

    env.scenario('copy a file', async () => {
        await env.request('/fs/copy', {
            json: {
                source: `${bench()}/small.txt`,
                destination: `${bench()}/copies`,
                new_name: `copy-${run++}.txt`,
            },
        });
    });

    let deletes = 0;
    env.scenario('delete a file', async () => {
        await env.request('/fs/delete', {
            json: { path: `${bench()}/trash/file-${deletes++}.txt` },
        });
    });

    env.scenario('write 10 small files in one batch', async () => {
        const batch = run++;
        await env.request('/fs/batchWrite', {
            json: Array.from({ length: 10 }, (_, i) =>
                fileBody(`${bench()}/batches/batch-${batch}-${i}.txt`),
            ),
        });
    });
});
