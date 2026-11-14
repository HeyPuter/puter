import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';
import { createTestUser } from '../../testUtil.js';

describe('sharing', () => {
    let shareable = '';
    // The share scenario takes a fresh recipient each run, so no run reads
    // what the run before it wrote.
    const recipients: string[] = [];

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
        const kept = await write('kept.txt');
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
});
