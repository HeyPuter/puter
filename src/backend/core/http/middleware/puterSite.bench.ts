import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../../benchUtil.js';

const SUBDOMAIN = 'bench-site';

describe('hosted sites', () => {
    const seed = async (env: BenchEnv) => {
        const { fs } = env.server.services;
        const { username } = env.users.user;
        const owner = await env.server.stores.user.getByUsername(username);
        const root = `/${username}/Public/bench-site`;
        const write = (path: string, body: string, contentType: string) => {
            const content = Buffer.from(body);
            return fs.write(owner!.id, {
                fileMetadata: {
                    path: `${root}/${path}`,
                    size: content.byteLength,
                    contentType,
                    createMissingParents: true,
                },
                fileContent: content,
            });
        };

        await write(
            'index.html',
            '<html><body>bench</body></html>',
            'text/html',
        );
        await write(
            'assets/app.js',
            'console.log("bench");',
            'text/javascript',
        );
        const rootDir = await env.server.stores.fsEntry.getEntryByPath(root);
        await env.server.stores.subdomain.create({
            userId: owner!.id,
            subdomain: SUBDOMAIN,
            rootDirId: rootDir!.id,
        });
    };

    const env = useBenchEnv({ seed });

    const site = async (path: string, subdomain = SUBDOMAIN, status = 200) => {
        const { port } = new URL(env.origin);
        const response = await fetch(
            `http://${subdomain}.site.puter.localhost:${port}${path}`,
        );
        await response.text();
        if (response.status !== status) {
            throw new Error(`${subdomain}${path} answered ${response.status}`);
        }
    };

    env.scenario('serve the index page of a site', async () => {
        await site('/');
    });

    env.scenario('serve a static asset of a site', async () => {
        await site('/assets/app.js');
    });

    env.scenario('answer 404 for a file a site does not have', async () => {
        await site('/missing.css', SUBDOMAIN, 404);
    });

    env.scenario('answer 404 for a site that does not exist', async () => {
        await site('/', 'bench-no-such-site', 404);
    });
});
