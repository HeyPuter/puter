import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';
import { createTestUser } from '../../testUtil.js';

describe('sharing', () => {
    let shareable = '';
    let kept = '';
    // The share scenario takes a fresh recipient each run, so no run reads
    // what the run before it wrote.
    const recipients: string[] = [];
    // One standing share per run of the withdraw scenario, from an owner of
    // its own so the other scenarios' listings stay as they were.
    let revocable = '';
    let revoker = '';
    const holders: string[] = [];

    const dir = () => `/${env.users.user.username}/Documents/shared`;

    const seed = async (env: BenchEnv) => {
        const { fs } = env.server.services;
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const write = async (name: string) => {
            const content = Buffer.from('share bench');
            const { fsEntry } = await fs.write(owner!.id, {
                fileMetadata: {
                    path: `${dir()}/${name}`,
                    size: content.byteLength,
                    contentType: 'text/plain',
                },
                fileContent: content,
            });
            return fsEntry.uuid;
        };

        await fs.mkdir(owner!.id, { path: dir() });
        kept = await write('kept.txt');
        const folder = await fs.mkdir(owner!.id, { path: `${dir()}/folder` });
        for (let i = 0; i < 5; i++) await write(`folder/file-${i}.txt`);
        shareable = await write('shareable.txt');
        for (let i = 0; i < 12; i++) {
            const { username } = await createTestUser(env.server, {
                username: `sharebench${i}`,
                password: 'share-bench-password',
            });
            recipients.push(username);
        }
        await env.request('/share', {
            json: {
                recipients: [env.users.other.username],
                items: [{ uid: kept }, { uid: folder.uuid }],
                mode: 'read',
            },
        });
        const revokerUser = await createTestUser(env.server, {
            username: 'sharebenchrevoker',
            password: 'share-bench-password',
        });
        revoker = revokerUser.token;
        const content = Buffer.from('share bench');
        const revokerRow = await env.server.stores.user.getByUsername(
            revokerUser.username,
        );
        ({
            fsEntry: { uuid: revocable },
        } = await fs.write(revokerRow!.id, {
            fileMetadata: {
                path: `/${revokerUser.username}/Documents/revocable.txt`,
                size: content.byteLength,
                contentType: 'text/plain',
            },
            fileContent: content,
        }));
        // Two warm-up runs and seven recorded ones.
        for (let i = 0; i < 9; i++) {
            const { username } = await createTestUser(env.server, {
                username: `sharebenchholder${i}`,
                password: 'share-bench-password',
            });
            holders.push(username);
        }
        await env.request('/share', {
            json: {
                recipients: holders,
                items: [{ uid: revocable }],
                mode: 'read',
            },
            token: revoker,
        });
    };

    const env = useBenchEnv({ seed });
    const asRecipient = () => ({ token: env.users.other.token });

    env.scenario('list what is shared with me', async () => {
        await env.request('/share/shared-with-me', asRecipient());
    });

    env.scenario('list what I have shared', async () => {
        await env.request('/share/shared-by-me');
    });

    env.scenario('stat a file shared with me', async () => {
        await env.request('/fs/stat', {
            json: { path: `${dir()}/kept.txt` },
            ...asRecipient(),
        });
    });

    env.scenario('read a file shared with me', async () => {
        const path = encodeURIComponent(`${dir()}/kept.txt`);
        await env.request(`/fs/read?path=${path}`, asRecipient());
    });

    env.scenario('list a directory shared with me', async () => {
        await env.request('/fs/readdir', {
            json: { path: `${dir()}/folder` },
            ...asRecipient(),
        });
    });

    env.scenario('list who can reach a file I shared', async () => {
        await env.request(`/share/shares?uid=${kept}`);
    });

    let shares = 0;
    env.scenario('share a file with a user by username', async () => {
        await env.request('/share', {
            json: {
                recipients: [recipients[shares++]],
                items: [{ uid: shareable }],
                mode: 'read',
            },
        });
    });

    let withdrawals = 0;
    env.scenario('withdraw a file share from a user', async () => {
        await env.request('/share/revoke', {
            json: {
                recipients: [holders[withdrawals++]],
                items: [{ uid: revocable }],
            },
            token: revoker,
        });
    });
});
