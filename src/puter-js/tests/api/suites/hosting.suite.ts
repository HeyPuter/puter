import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

/**
 * Sites are served on `<subdomain>.<static_hosting_domain>` — with the
 * default test config that's `<subdomain>.site.puter.localhost`, which
 * resolves to loopback like every other *.localhost name.
 *
 * The subdomain driver requires `root_dir` to be an existing directory,
 * so every test creates one first.
 */
const siteUrl = (t: TestContext, subdomain: string) => {
    const port = new URL(t.env.apiOrigin).port;
    return `http://${subdomain}.site.puter.localhost:${port}/`;
};

const makeSiteDir = async (t: TestContext, name: string, html?: string) => {
    const dir = `${home(t)}/hosting-suite-${name}`;
    await t.puter.fs.mkdir(dir);
    if (html) await t.puter.fs.write(`${dir}/index.html`, html);
    return dir;
};

export default suite('hosting', {
    'create registers a subdomain retrievable by get': async (t) => {
        const dir = await makeSiteDir(t, 'create');
        const created = await t.puter.hosting.create('hosting-suite-create', dir);
        t.assert.equal(created.subdomain, 'hosting-suite-create');
        const fetched = await t.puter.hosting.get('hosting-suite-create');
        t.assert.equal(fetched.subdomain, 'hosting-suite-create');
    },

    'create without an existing root dir rejects': async (t) => {
        await t.assert.rejects(
            () =>
                t.puter.hosting.create(
                    'hosting-suite-no-dir',
                    `${home(t)}/hosting-suite-does-not-exist`,
                ),
            'create pointing at a missing directory should reject',
        );
    },

    'create with a duplicate subdomain rejects': async (t) => {
        const dir = await makeSiteDir(t, 'dup');
        await t.puter.hosting.create('hosting-suite-dup', dir);
        await t.assert.rejects(
            () => t.puter.hosting.create('hosting-suite-dup', dir),
            'duplicate subdomain should reject',
        );
    },

    'list includes created subdomains': async (t) => {
        const dir = await makeSiteDir(t, 'listed');
        await t.puter.hosting.create('hosting-suite-listed', dir);
        const sites = await t.puter.hosting.list();
        t.assert.ok(
            sites.some(
                (s: { subdomain: string }) =>
                    s.subdomain === 'hosting-suite-listed',
            ),
            'created subdomain should appear in list',
        );
    },

    'list pages with cursors and reports totals': async (t) => {
        const names = [
            'hosting-suite-pg-a',
            'hosting-suite-pg-b',
            'hosting-suite-pg-c',
        ];
        for (const name of names) {
            const dir = await makeSiteDir(t, `pg-${name.slice(-1)}`);
            await t.puter.hosting.create(name, dir);
        }

        const seen: string[] = [];
        let cursor: string | null | undefined = null;
        do {
            const page = (await t.puter.hosting.list({
                limit: 2,
                cursor,
                includeTotal: true,
            })) as {
                items: Array<{ subdomain: string }>;
                cursor?: string;
                total?: number;
            };
            t.assert.ok(Array.isArray(page.items), 'page should carry items');
            t.assert.ok(
                (page.total ?? 0) >= names.length,
                'total should count at least the created subdomains',
            );
            seen.push(...page.items.map((s) => s.subdomain));
            cursor = page.cursor;
        } while (cursor);
        for (const name of names) {
            t.assert.ok(seen.includes(name), `${name} should appear while paging`);
        }
    },

    'list with stream iterates pages via for await': async (t) => {
        const names = ['hosting-suite-st-a', 'hosting-suite-st-b', 'hosting-suite-st-c'];
        for (const name of names) {
            const dir = await makeSiteDir(t, `st-${name.slice(-1)}`);
            await t.puter.hosting.create(name, dir);
        }

        const seen: string[] = [];
        let pages = 0;
        for await (const page of t.puter.hosting.list({ stream: true, limit: 2 }) as AsyncIterable<{
            items: Array<{ subdomain: string }>;
            cursor?: string;
        }>) {
            pages++;
            t.assert.ok(page.items.length <= 2, 'stream pages respect limit');
            seen.push(...page.items.map((s) => s.subdomain));
        }
        t.assert.ok(pages >= 2, 'stream should yield multiple pages');
        for (const name of names) {
            t.assert.ok(seen.includes(name), `${name} should appear while streaming`);
        }
    },

    'a subdomain serves its root directory': async (t) => {
        const dir = await makeSiteDir(
            t,
            'served',
            '<h1>hosting suite index</h1>',
        );
        await t.puter.hosting.create('hosting-suite-served', dir);

        const res = await fetch(siteUrl(t, 'hosting-suite-served'));
        t.assert.equal(res.status, 200);
        const body = await res.text();
        t.assert.ok(
            body.includes('hosting suite index'),
            'served page should contain the index content',
        );
    },

    'update repoints the subdomain to a new directory': async (t) => {
        const dirA = await makeSiteDir(t, 'dir-a', 'site A');
        const dirB = await makeSiteDir(t, 'dir-b', 'site B');

        await t.puter.hosting.create('hosting-suite-repoint', dirA);
        const before = await fetch(siteUrl(t, 'hosting-suite-repoint'));
        t.assert.ok((await before.text()).includes('site A'));

        await t.puter.hosting.update('hosting-suite-repoint', dirB);
        const after = await fetch(siteUrl(t, 'hosting-suite-repoint'));
        t.assert.ok(
            (await after.text()).includes('site B'),
            'updated subdomain should serve the new directory',
        );
    },

    'get of an unknown subdomain rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.hosting.get('hosting-suite-never-created'),
            'get of an unknown subdomain should reject',
        );
    },

    'update to a missing directory rejects': async (t) => {
        const dir = await makeSiteDir(t, 'update-missing');
        await t.puter.hosting.create('hosting-suite-update-missing', dir);
        await t.assert.rejects(
            () =>
                t.puter.hosting.update(
                    'hosting-suite-update-missing',
                    `${home(t)}/hosting-suite-not-a-dir`,
                ),
            'update pointing at a missing directory should reject',
        );
    },

    'delete removes the subdomain': async (t) => {
        const dir = await makeSiteDir(t, 'delete');
        await t.puter.hosting.create('hosting-suite-delete', dir);
        await t.puter.hosting.delete('hosting-suite-delete');
        await t.assert.rejects(
            () => t.puter.hosting.get('hosting-suite-delete'),
            'get of a deleted subdomain should reject',
        );
    },
});
