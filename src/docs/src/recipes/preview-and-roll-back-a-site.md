---
title: Preview and Roll Back a Site
description: "Learn how to let users preview a new version of their website before it goes live with Puter.js, and roll back to an older version in one click."
tags: [hosting, fs, kv]
order: 57
---

When your app [publishes websites](/recipes/add-website-publishing/) for its
users, every edit goes live the moment it is published. A typo, a broken link or
a missing image is in front of every visitor until the user fixes it.

A safer flow has three steps. Each version is saved to its own folder. The user
first sees it on a separate preview address. Then they make it live, and they
can go back to an older version if something is wrong. The
[hosting API](/Hosting/) makes each step one call, because a site is just a name
that points at a folder.

The examples below use two sites per project: `grace-portfolio` is the live
site, and `grace-portfolio-preview` is the preview.

## Save Each Version to Its Own Folder

Never write over the folder the live site serves. Write each version to a new
folder instead, numbered with [`puter.kv.incr()`](/KV/incr/):

```js
async function saveVersion(projectId, files) {
    const n = await puter.kv.incr(`site:${projectId}:lastVersion`);
    const dir = `site-versions/${projectId}/v${n}`;

    for (const [path, content] of Object.entries(files)) {
        await puter.fs.write(`${dir}/${path}`, content, { createMissingParents: true });
    }
    return { n, dir };
}

const version = await saveVersion('portfolio', {
    'index.html': '<h1>Grace Hopper</h1><img src="images/me.jpg">',
    'images/me.jpg': photoBlob,
});
// { n: 4, dir: 'site-versions/portfolio/v4' }
```

[`puter.kv.incr()`](/KV/incr/) adds 1 on the server and returns the new
number, so two saves at the same time never get the same folder.
`createMissingParents` creates `v4` and `v4/images` as part of the write.

## Show a Preview

Point the preview site at the new folder. The first time, there is no preview
site yet, so create it with [`puter.hosting.create()`](/Hosting/create/). After
that, move it with [`puter.hosting.update()`](/Hosting/update/):

```js
async function pointSite(name, dir) {
    try {
        return await puter.hosting.update(name, dir);
    } catch {
        return await puter.hosting.create(name, dir);
    }
}

await pointSite('grace-portfolio-preview', version.dir);
// https://grace-portfolio-preview.puter.site now shows version 4
```

`update()` rejects when the site does not exist yet, which is what sends the
first call to `create()`. Show the user a link to the preview address so they
can click through it before anything changes for their visitors.

## Make It Live

When the user is happy, point the live site at the same folder. Nothing is
uploaded again, because the files are already in place:

```js
async function publish(projectId, version) {
    await pointSite('grace-portfolio', version.dir);

    const history = (await puter.kv.get(`site:${projectId}:history`)) ?? [];
    history.push({ n: version.n, dir: version.dir, at: Date.now() });
    await puter.kv.set(`site:${projectId}:history`, history);
}

await publish('portfolio', version);
```

The live address stays the same. Visitors get the new version on their next page
load, and nobody ever sees a half-written folder.

The history is a small list of every version that has been live, kept in one
[key-value](/KV/) entry. See [Store a small list](/recipes/store-small-list/)
for when one entry is enough.

## Roll Back

To undo a release, point the live site at the version before it:

```js
async function rollBack(projectId) {
    const history = (await puter.kv.get(`site:${projectId}:history`)) ?? [];
    if (history.length < 2) {
        throw new Error('there is no older version to go back to');
    }

    history.pop();
    const previous = history[history.length - 1];
    await puter.hosting.update('grace-portfolio', previous.dir);
    await puter.kv.set(`site:${projectId}:history`, history);
    return previous;
}
```

The bad version's folder is still there. Only the site stops pointing at it, so
the user can preview it again, fix it and publish once more. To jump to any
older version instead of just the last one, call
[`puter.hosting.update()`](/Hosting/update/) with that version's `dir`.

## Delete Old Versions

Every version is a full copy of the site, so delete old ones from time to time.
Keep the last few that have been live, and never delete the one the live or
preview site points at:

```js
async function deleteOldVersions(projectId, keep = 5) {
    const history = (await puter.kv.get(`site:${projectId}:history`)) ?? [];
    const lastVersion = await puter.kv.get(`site:${projectId}:lastVersion`);

    const kept = new Set(history.slice(-keep).map(v => v.n));
    kept.add(lastVersion);   // the version the preview shows, which may not be live yet

    for (let n = 1; n <= lastVersion; n++) {
        if (!kept.has(n)) {
            await puter.fs.delete(`site-versions/${projectId}/v${n}`).catch(() => {});
        }
    }
    await puter.kv.set(`site:${projectId}:history`, history.filter(v => kept.has(v.n)));
}
```

[`puter.fs.delete()`](/FS/delete/) removes a folder with everything in it. The
`catch` skips folders that were already deleted on an earlier run.

## Notes

- Both sites belong to the user and count toward their sites. When your code
  runs as a Puter app, it can only change sites that app created. See
  [Manage websites](/recipes/manage-websites/).
- The preview address is public, just harder to guess. Don't put anything on it
  that must stay private.
- To take the preview offline after publishing, call
  [`puter.hosting.delete()`](/Hosting/delete/) with its name. The version's
  folder is kept.
