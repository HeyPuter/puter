import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';
import { makeActor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';

describe('permissions', () => {
    let appToken = '';
    let grantedUid = '';
    let fileUid = '';
    // The grant scenario takes a fresh app each run, so no run reads what the
    // run before it wrote.
    const grantees: string[] = [];

    const dir = () => `/${env.users.user.username}/Documents/permissions`;

    const seed = async (env: BenchEnv) => {
        const { fs, permission, auth } = env.server.services;
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const actor = makeActor({ user: owner! });
        const write = async (name: string) => {
            const content = Buffer.from('permission bench');
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
        grantedUid = await write('granted.txt');
        await write('private.txt');
        fileUid = await write('grantable.txt');
        for (let i = 0; i < 12; i++) {
            const grantee = await env.server.stores.app.create(
                {
                    name: `permission-bench-grantee-${i}`,
                    title: 'Permission bench grantee',
                    index_url: `https://permission-bench-grantee-${i}.test/`,
                },
                { ownerUserId: owner!.id },
            );
            grantees.push(grantee.uid);
        }

        const app = await env.server.stores.app.create(
            {
                name: 'permission-bench-app',
                title: 'Permission bench app',
                index_url: 'https://permission-bench-app.test/',
            },
            { ownerUserId: owner!.id },
        );
        await runWithContext({ actor }, () =>
            permission.grantUserAppPermission(
                actor,
                app.uid,
                `fs:${grantedUid}:read`,
            ),
        );
        appToken = await auth.getUserAppToken(actor, app.uid);
    };

    const env = useBenchEnv({ seed });

    /** A stat that must be refused; a refusal that passes is not a benchmark. */
    const refusedStat = async (path: string, token: string) => {
        const response = await fetch(new URL('/fs/stat', env.apiOrigin), {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ path }),
        });
        await response.text();
        if (response.status !== 403 && response.status !== 404) {
            throw new Error(`stat of ${path} answered ${response.status}`);
        }
    };

    env.scenario('an app stats a file it was granted', async () => {
        await env.request('/fs/stat', {
            json: { path: `${dir()}/granted.txt` },
            token: appToken,
        });
    });

    env.scenario('an app reads a file it was granted', async () => {
        const path = encodeURIComponent(`${dir()}/granted.txt`);
        await env.request(`/fs/read?path=${path}`, { token: appToken });
    });

    env.scenario('an app is refused a file it was not granted', async () => {
        await refusedStat(`${dir()}/private.txt`, appToken);
    });

    env.scenario("a user is refused another user's file", async () => {
        await refusedStat(`${dir()}/private.txt`, env.users.other.token);
    });

    env.scenario('an app checks two of its permissions', async () => {
        await env.request('/auth/check-permissions', {
            json: {
                permissions: [`fs:${grantedUid}:read`, `fs:${fileUid}:read`],
            },
            token: appToken,
        });
    });

    env.scenario('list the permissions I have granted', async () => {
        await env.request('/auth/list-permissions');
    });

    let grants = 0;
    env.scenario('grant an app access to a file', async () => {
        await env.request('/auth/grant-user-app', {
            json: {
                app_uid: grantees[grants++],
                permission: `fs:${fileUid}:read`,
            },
        });
    });
});
