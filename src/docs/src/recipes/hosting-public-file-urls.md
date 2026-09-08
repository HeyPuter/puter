---
title: Turn an uploaded file into a public URL
description: Publish one directory with puter.hosting.create(), then every file puter.fs.upload() or puter.fs.write() puts in it has a shareable https://<subdomain>.puter.site link — for avatars, image uploads, CDN assets and share links.
tags: [fs, hosting]
order: 50
---

**Use this when** a file lives in the user's Puter filesystem and you need a
link for it: an `<img src>`, an avatar, a generated asset, or a URL to paste
into a chat. Files written with [`puter.fs.write()`](/FS/write/) and
[`puter.fs.upload()`](/FS/upload/) are reachable only through the SDK, and
publishing them is the [hosting API](/Hosting/create/)'s job.

The technique is to publish a **directory** once, not a file each time. After
that, every file in it already has a URL you can work out from its name.

## Publish one directory

[`puter.hosting.create()`](/Hosting/create/) maps a subdomain onto a directory:

```js
const dir  = await puter.fs.mkdir('public');
const site = await puter.hosting.create(puter.randName(), 'public');

site.subdomain;        // 'lucky-hill-8121'
site.uid;              // '0267d3a2-f52a-4a37-964c-6b8d9f945dd6'
site.root_dir.path;    // '/username/public'
```

`site.subdomain` is the label; the site itself is at
`https://<subdomain>.puter.site`. Everything under `root_dir` is served from
there, including files added long after this call — the mapping is to the
directory, not to a snapshot of it.

Subdomain names are global, so `puter.randName()` (or any id of your own) claims
one nobody else has. A name already in use rejects with a `conflict` error
reading *"A site with this subdomain already exists"*, so catch it and try
another name.

## Reuse the same subdomain on later runs

One directory needs one subdomain for its lifetime. Ask the directory whether it
already has one before claiming another:

```js
const DIR = 'public';

async function publicSite () {
    const dir = await puter.fs.stat(DIR, { returnSubdomains: true })
        .catch(() => puter.fs.mkdir(DIR));

    // [{ uuid, subdomain, address: 'https://lucky-hill-8121.puter.site' }]
    const existing = dir.subdomains?.[0];
    const subdomain = existing
        ? existing.subdomain
        : (await puter.hosting.create(puter.randName(), DIR)).subdomain;

    return { dir, base: `https://${subdomain}.puter.site` };
}
```

[`stat()`](/FS/stat/) returns `subdomains` only when `returnSubdomains: true` is
passed. Each entry carries the label and a ready-made `address`.

## Write files into it

Both write methods take the published directory as their destination, and both
hand back the [`FSItem`](/Objects/fsitem/) that was actually stored:

```js
// Generated content
const item = await puter.fs.write('public/report.csv', csvText);

// A <input type="file"> or a drag-and-drop FileList
const items = await puter.fs.upload(fileInput.files, 'public');
```

`upload()` deduplicates names by default, so `photo.png` may land as
`photo (1).png` when the name is taken. Reading the name back off the result is
what keeps the URL right:

```js
const stored = [].concat(items);
stored.map(f => f.name);     // ['photo (1).png']
```

## Compose the URL

The path under the published directory is the path after the host, one path
segment at a time:

```
/username/public/photo.png            →  https://lucky-hill-8121.puter.site/photo.png
/username/public/2026/march/pic.jpg   →  https://lucky-hill-8121.puter.site/2026/march/pic.jpg
```

Subdirectories carry straight through. Taking the relative part off the stored
item's `path` gets there from any of the write methods:

```js
const { dir, base } = await publicSite();
const item = await puter.fs.write(`${dir.path}/photo.png`, blob);

const url = base + item.path.slice(dir.path.length);
// https://lucky-hill-8121.puter.site/photo.png
```

Names made of letters, digits, `.`, `-` and `_` go into a URL unchanged, and a
space is `%20`. Generating the stored name yourself keeps every URL in that set
whatever the user's file was called:

```js
const safe = name => name.replace(/[^A-Za-z0-9._-]/g, '-');
```

## Complete example

Pick an image, upload it into the published directory, and get a link anyone
can open:

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <input type="file" id="file-input" accept="image/*">
    <div id="out"></div>
    <script>
    const DIR = 'public';

    async function publicSite () {
        const dir = await puter.fs.stat(DIR, { returnSubdomains: true })
            .catch(() => puter.fs.mkdir(DIR));

        const existing = dir.subdomains?.[0];
        const subdomain = existing
            ? existing.subdomain
            : (await puter.hosting.create(puter.randName(), DIR)).subdomain;

        return { dir, base: `https://${subdomain}.puter.site` };
    }

    document.getElementById('file-input').onchange = async (e) => {
        const { dir, base } = await publicSite();

        // A random prefix makes the URL unguessable and the name URL-safe.
        const file = e.target.files[0];
        const name = `${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '-')}`;

        const item = await puter.fs.write(`${DIR}/${name}`, file);
        const url  = base + item.path.slice(dir.path.length);

        document.getElementById('out').innerHTML =
            `<a href="${url}" target="_blank">${url}</a><br><img src="${url}" width="300">`;
    };
    </script>
</body>
</html>
```

Swap `puter.fs.write` for `puter.fs.upload(e.target.files, DIR)` to take several
files at once, and map over the returned array.

## Manage what is published

```js
const sites = await puter.hosting.list();      // every site, each with its root_dir
sites.map(s => [s.subdomain, s.root_dir.path]);

await puter.hosting.get('lucky-hill-8121');    // one site, or rejects if it is gone
await puter.hosting.update('lucky-hill-8121', 'public-v2');   // serve a different directory
await puter.hosting.delete('lucky-hill-8121'); // take the site offline
```

[`update()`](/Hosting/update/) re-points an existing subdomain, which is how a
link stays valid while the directory behind it moves.
[`delete()`](/Hosting/delete/) removes the subdomain and leaves the directory and
its files untouched, so the same files can be republished under a new name later.

## Keep the public directory separate

Serving is by directory, so the directory boundary is the privacy boundary:
every file under `root_dir` — including ones written after the site was created
— is returned to anyone who requests its URL, with no Puter account involved.
Files the user has not chosen to share belong in a sibling directory that no
subdomain points at.

```js
await puter.fs.mkdir('public');       // published — links work for anyone
await puter.fs.mkdir('documents');    // not published — SDK access only
```

Within the public directory, the filename is what gates access. There is no
directory index — `https://<subdomain>.puter.site/` and every directory path
return `404` unless a file sits at exactly that path — so a name nobody can
guess is a link only its recipients hold:

```js
const name = `${crypto.randomUUID()}.png`;
await puter.fs.write(`public/${name}`, blob);
```

Use that for anything meant for specific people, and keep short readable names
for assets you would put on a landing page anyway. To revoke a link, delete the
file with [`puter.fs.delete()`](/FS/delete/) or move it out of the published
directory.

## Notes

- Subdomain labels are lowercase letters, digits and hyphens, up to **64
  characters**, with no leading or trailing hyphen. Uppercase input is
  lowercased; a handful of names (`www`, `api`, `admin`, `test`, …) are
  reserved. A full host like `lucky-hill-8121.puter.site` is accepted anywhere a
  label is, and trimmed to the label.
- An account may hold up to **500** subdomains. One uploads directory per app,
  reused, keeps a file-upload feature at one of them. See
  [rate limits and quotas](/rate-limits-and-quotas/) for the per-minute limits on
  `create` and reads.
- A relative `dirPath` resolves the same way for hosting as for the filesystem:
  against `~/AppData/<appID>/` inside a registered app, and against the home
  directory on a plain website. Passing the same relative path to
  `puter.fs.write()` and `puter.hosting.create()` therefore lands on the same
  directory in both cases.
- Responses carry `Access-Control-Allow-Origin: *`, so a published URL works
  from any origin — `fetch()`, `<img>`, `<video>`, a CSS `url()`. The
  `Content-Type` comes from the stored file, so `.png` arrives as `image/png`.
- Path segments encode a space as `%20`. Names outside the letters, digits, `.`,
  `-`, `_` and space set need further percent-encoding, which the edge currently
  answers with a redirect to the same URL — generating the stored name keeps
  every link in the set that resolves.
- Inside a registered app, `puter.hosting.list()` and `get()` see the sites that
  app created. A site created by the Puter desktop or another app of yours is
  visible from `puter.fs.stat(dir, { returnSubdomains: true })` on its directory.
- Publishing a directory someone shared with you requires `manage` access on it —
  the level [`share()`](/FS/share/) calls "Can edit & share".
- Dropping an `index.html` into the published directory turns the same subdomain
  into a real site, which is what [`puter.hosting.create()`](/Hosting/create/)
  documents on its own.
