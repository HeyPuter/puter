import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';

// The routes puter.js and the desktop still call outside `/fs/*`.
describe('legacy fs', () => {
    const home = () => `/${env.users.user.username}`;

    const seed = async (env: BenchEnv) => {
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const content = Buffer.from('opened by a benchmark');
        await env.server.services.fs.write(owner!.id, {
            fileMetadata: {
                path: `${home()}/Documents/opened.txt`,
                size: content.byteLength,
                contentType: 'text/plain',
            },
            fileContent: content,
        });
    };

    const env = useBenchEnv({ seed });

    env.scenario('list a home directory through the SDK route', async () => {
        await env.request('/readdir', { json: { path: home() } });
    });

    env.scenario('stat a file through the SDK route', async () => {
        await env.request('/stat', {
            json: { path: `${home()}/Documents/opened.txt` },
        });
    });

    env.scenario('open a file from the desktop', async () => {
        await env.request('/open_item', {
            json: { path: `${home()}/Documents/opened.txt` },
        });
    });

    env.scenario('read my storage usage', async () => {
        await env.request('/df', { json: {} });
    });
});
