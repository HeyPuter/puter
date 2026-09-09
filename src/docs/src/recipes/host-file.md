---
title: Host Files Online
description: "Learn how to host files from the user's Puter filesystem online and give them a public URL that anyone can open."
tags: [fs, hosting]
order: 50
---

A file written with [`puter.fs.write()`](/FS/write/) or
[`puter.fs.upload()`](/FS/upload/) lives in the user's Puter filesystem, where
only the SDK can reach it. To hand out a link anyone can open, such as an
`<img>` source or a URL you can share, host the directory that file is in
online. You host the directory once, and every file you put in it after that
already has a URL.

## Host a Directory

To host a directory, use the [`puter.hosting.create()`](/Hosting/create/)
method. It maps a subdomain onto a directory:

```js
const dir  = await puter.fs.mkdir('public');
const site = await puter.hosting.create(puter.randName(), 'public');

site.subdomain;        // 'lucky-hill-8121'
site.root_dir.path;    // '/username/public'
```

The site is at `https://<subdomain>.puter.site`, and everything inside the directory
will be served from there.

Subdomain names are global, so [`puter.randName()`](/Utils/randName/) claims one
nobody else has. A name already in use rejects with a `conflict` error, so catch
it and try another name.

## Reuse the Same Subdomain

One directory needs one subdomain for its lifetime. To find the subdomain a
directory already has, use the [`puter.fs.stat()`](/FS/stat/) method with
`returnSubdomains: true`:

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

    return { dir, base: `https://${ subdomain }.puter.site` };
}
```

Each entry carries the label and a ready-made `address`.

## Write Files Into It

To put a file in the hosted directory, use the [`puter.fs.write()`](/FS/write/)
or [`puter.fs.upload()`](/FS/upload/) method. Both hand back the
[`FSItem`](/Objects/fsitem/) that was stored:

```js
const item  = await puter.fs.write('public/report.csv', csvText);
const items = await puter.fs.upload(fileInput.files, 'public');
```

The [`puter.fs.upload()`](/FS/upload/) method deduplicates names, so `photo.png`
lands as `photo (1).png` when the name is taken. Read the name back off the
result and use it to keep the URL consistent.

## Compose the URL

Everything inside the directory you host is reachable at the site address, and
any folder inside it becomes part of the URL:

```
public/photo.png            →  https://lucky-hill-8121.puter.site/photo.png
public/2026/march/pic.jpg   →  https://lucky-hill-8121.puter.site/2026/march/pic.jpg
```

In code, that is the site address followed by the path you wrote the file to:

```js
const { base } = await publicSite();

await puter.fs.write('public/2026/photo.png', blob);

const url = `${ base }/2026/photo.png`;
// https://lucky-hill-8121.puter.site/2026/photo.png
```

## Revoke a Link

To take a link offline, delete the file with the
[`puter.fs.delete()`](/FS/delete/) method:

```js
await puter.fs.delete('public/photo.png');
```
