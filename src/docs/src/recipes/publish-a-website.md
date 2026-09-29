---
title: Publish a Website
description: "Learn how to publish a website from your app with Puter.js, giving a folder of HTML files its own public puter.site address."
tags: [hosting, fs]
order: 55
---

The [hosting API](/Hosting/) turns a folder in the user's Puter account into a
public website at `https://<name>.puter.site`. Anyone can open it, with no sign
in and no Puter.js. Your app writes the files with the
[filesystem API](/FS/), then publishes the folder with one call.

This lets you build a website builder, a portfolio generator, or an "export as
website" button, with the site hosted in the user's own account.

## Publish a One-Page Site

Write an `index.html` into a folder, then pass a name and the folder to
[`puter.hosting.create()`](/Hosting/create/):

```js
await puter.fs.mkdir('my-site');
await puter.fs.write('my-site/index.html', '<h1>Hello, world!</h1>');

const site = await puter.hosting.create('grace-portfolio', 'my-site');

console.log(`https://${site.subdomain}.puter.site`);
```

The site is now online at that address. A request for `/`, or for any folder,
is answered with that folder's `index.html`.

## Pick a Name

Site names are shared by every Puter user, so a name someone already has is not
free. [`puter.hosting.create()`](/Hosting/create/) then rejects with a
`conflict` error. Catch it and offer another name, or let
[`puter.randName()`](/Utils/randName/) pick one nobody has:

```js
async function publish (dir, name) {
    try {
        return await puter.hosting.create(name, dir);
    } catch (e) {
        if (e?.code !== 'conflict') throw e;
        return await puter.hosting.create(puter.randName(), dir);
    }
}
```

A name can use lowercase letters, digits and hyphens, and cannot start or end
with a hyphen. A few names such as `www` and `api` are reserved.

## Change What It Shows

The site serves whatever is in the folder right now. To change a page, write
the file again. There is nothing to redeploy:

```js
await puter.fs.write('my-site/index.html', '<h1>Hello again!</h1>');
```

The same goes for new files. Anything you add to the folder is online at the
matching path, such as `my-site/about.html` at `/about.html`.

## Serve a Single-Page App

An app with client-side routing needs every unknown path, such as
`/dashboard`, to load `index.html`. Write a
[`.puter_site_config`](/site-config/) file next to it:

```js
await puter.fs.write('my-site/.puter_site_config', JSON.stringify({
    errors: { 404: { file: '/index.html', status: 200 } },
}));
```

The config file is never served to visitors. Changes to it take up to a minute
to show.

## Add Dynamic Content

A hosted site is static: it serves the files in the folder as they are. Most
bigger sites also need something that runs on each request, such as saving a
form, loading data per user, or calling an AI model. Put that part in a
[serverless worker](/Workers/) and call it from the site's pages with
[`puter.workers.exec()`](/Workers/exec/):

```js
const res = await puter.workers.exec('https://my-site-api.puter.work/notes');
const notes = await res.json();
```

[Build an API with a worker](/recipes/workers-build-an-api/) shows how to write
those routes. To keep the backend in the same folder as the site, use a
[dynamic worker](/Workers/dynamic/) instead: a file such as
`my-site/__workers/api.worker.js` is served at
`https://<name>.puter.site/__workers/api/`, with no separate deploy.

## Notes

- Everything in the folder is public, including files you add later. Keep
  private files somewhere else.
- The user needs a verified email address to publish a site.
- A site's name cannot be changed. To move to a new name, create a site with it
  and [delete](/recipes/manage-websites/#delete-a-site) the old one.
- To hand out a link to one file rather than build a site, see
  [Host files online](/recipes/host-file/).
