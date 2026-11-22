import { describe } from 'vitest';
import { useBenchEnv, type BenchEnv } from '../../benchUtil.js';

// The routes puter.js and the desktop still call outside `/fs/*`.
describe('legacy fs', () => {
    const home = () => `/${env.users.user.username}`;

    let openedUid = '';
    // A 1x1 PNG, which is what the thumbnails extension will accept.
    const thumbnail =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    const seed = async (env: BenchEnv) => {
        const owner = await env.server.stores.user.getByUsername(
            env.users.user.username,
        );
        const content = Buffer.from('opened by a benchmark');
        const { fsEntry } = await env.server.services.fs.write(owner!.id, {
            fileMetadata: {
                path: `${home()}/Documents/opened.txt`,
                size: content.byteLength,
                contentType: 'text/plain',
            },
            fileContent: content,
        });
        openedUid = fsEntry.uuid;
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

    env.scenario("set a file's thumbnail from the dashboard", async () => {
        await env.request('/update-fsentry-thumbnail', {
            json: { uid: openedUid, thumbnail },
        });
    });

    env.scenario('sign several entries at once', async () => {
        await env.request('/sign', {
            json: {
                items: ['Documents', 'Desktop', 'Pictures', 'Videos'].map(
                    (name) => ({ path: `${home()}/${name}`, action: 'read' }),
                ),
            },
        });
    });

    env.scenario('read my storage usage', async () => {
        await env.request('/df', { json: {} });
    });
});
