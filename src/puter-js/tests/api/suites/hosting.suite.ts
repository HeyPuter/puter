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
        // Reading before the update matters: it populates the subdomain
        // lookup cache, so this also covers the update invalidating what the
        // read cached rather than losing a race with it.
        const before = await fetch(siteUrl(t, 'hosting-suite-repoint'));
        const beforeBody = await before.text();
        t.assert.ok(
            beforeBody.includes('site A'),
            `new subdomain should serve its directory, got ${JSON.stringify(beforeBody)}`,
        );

        await t.puter.hosting.update('hosting-suite-repoint', dirB);
        const after = await fetch(siteUrl(t, 'hosting-suite-repoint'));
        const afterBody = await after.text();
        t.assert.ok(
            afterBody.includes('site B'),
            `updated subdomain should serve the new directory, got ${JSON.stringify(afterBody)}`,
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

    'create accepts a full host and stores just the subdomain label': async (t) => {
        const dir = await makeSiteDir(t, 'fullhost');
        const created = await t.puter.hosting.create('hostingsuitefull.puter.site', dir);
        t.assert.equal(created.subdomain, 'hostingsuitefull');
        // Retrievable by the bare label and by the full host (both normalize).
        const byLabel = await t.puter.hosting.get('hostingsuitefull');
        t.assert.equal(byLabel.subdomain, 'hostingsuitefull');
        const byHost = await t.puter.hosting.get('hostingsuitefull.puter.com');
        t.assert.equal(byHost.subdomain, 'hostingsuitefull');
    },

    'list with a limit returns a plain array of subdomains': async (t) => {
        const dir = await makeSiteDir(t, 'limited');
        await t.puter.hosting.create('hosting-suite-limited', dir);
        const sites = (await t.puter.hosting.list({ limit: 2 })) as Array<{
            subdomain: string;
        }>;
        t.assert.equal(Array.isArray(sites), true, 'a limit alone keeps the array shape');
        t.assert.ok(sites.length <= 2, 'the limit should be respected');
    },

    'list with stream rejects offset client-side': async (t) => {
        let err: { code?: string; message?: string } | undefined;
        try {
            t.puter.hosting.list({ stream: true, offset: 1 } as never);
        } catch (e) {
            err = e as typeof err;
        }
        t.assert.equal(err?.code, 'invalid_request');
        t.assert.equal(
            err?.message,
            '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.',
        );
    },

    'list fires the legacy positional success callback': async (t) => {
        const dir = await makeSiteDir(t, 'cb');
        await t.puter.hosting.create('hosting-suite-cb', dir);
        let seen: Array<{ subdomain: string }> | undefined;
        const result = (await (
            t.puter.hosting.list as (
                s: (v: Array<{ subdomain: string }>) => void,
            ) => Promise<Array<{ subdomain: string }>>
        )((value) => { seen = value; })) as Array<{ subdomain: string }>;
        t.assert.ok(seen, 'the success callback should fire');
        t.assert.equal(seen?.length, result.length);
        t.assert.ok(
            seen?.some((site) => site.subdomain === 'hosting-suite-cb'),
            'the callback should receive the full listing',
        );
    },

    'create accepts the object form': async (t) => {
        const dir = await makeSiteDir(t, 'objform', 'object form site');
        const created = await t.puter.hosting.create({
            subdomain: 'hosting-suite-objform',
            root_dir: dir,
        });
        t.assert.equal(created.subdomain, 'hosting-suite-objform');
        const res = await fetch(siteUrl(t, 'hosting-suite-objform'));
        t.assert.ok(
            (await res.text()).includes('object form site'),
            'the object form should connect the directory too',
        );
    },

    'a hosted directory is reported by readdir': async (t) => {
        const dir = await makeSiteDir(t, 'flagged', 'flagged site');
        await t.puter.hosting.create('hosting-suite-flagged', dir);
        const entries = await t.puter.fs.readdir(home(t));
        const entry = entries.find(
            (e: { name: string }) => e.name === 'hosting-suite-flagged',
        ) as { has_website?: boolean; subdomains?: unknown[] } | undefined;
        t.assert.ok(entry, 'the hosted directory should appear in its parent listing');
        t.assert.equal(Array.isArray(entry?.subdomains), true);
        t.assert.equal(entry?.has_website, true, 'the directory should be flagged as hosted');
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
