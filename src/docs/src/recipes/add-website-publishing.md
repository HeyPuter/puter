---
title: Add Website Publishing
description: "Learn how to let users publish websites from your app with Puter.js."
tags: [hosting, fs]
order: 55
---

Some apps let users make something that belongs on the web, like a site
builder or a portfolio maker. When the user is done, they want it online at a
link they can share. Usually that means your app runs its own hosting, with
servers to store every user's files and a domain to serve them from.

With Puter.js, your app publishes the site straight from the browser, like a
static host such as GitHub Pages. It writes the files into a folder in the
user's Puter account with the [filesystem API](/FS/), then puts that folder
online at `https://<name>.puter.site` with the [hosting API](/Hosting/). The
site lives in the user's account, so there is no server for you to run. Anyone
can open the link, with no sign in and no Puter.js.

## Publish What the User Made

Turn the user's project into HTML, write it as `index.html` in a folder, then
pass a site name and the folder to
[`puter.hosting.create()`](/Hosting/create/):

```js
function renderPage (project) {
    return `<!doctype html>
<title>${project.title}</title>
<h1>${project.title}</h1>
<p>${project.bio}</p>
<img src="photo.jpg">`;
}

const dir = `sites/${project.id}`;

await puter.fs.write(`${dir}/index.html`, renderPage(project), { createMissingParents: true });
await puter.fs.write(`${dir}/photo.jpg`, project.photo);

const site = await puter.hosting.create('grace-portfolio', dir);

console.log(`https://${site.subdomain}.puter.site`);
```

The site now serves the folder. A request for `/` gets `index.html`, and every
other file is served at its path, such as `photo.jpg` at `/photo.jpg`. Everything
in the folder is public, so write only what the user means to publish.

## Let the User Pick a Name

Site names are shared by every Puter user, so the name the user wants may
already be taken. In that case [`puter.hosting.create()`](/Hosting/create/)
rejects with a `conflict` error. Catch it to ask the user for another name, or
let [`puter.randName()`](/Utils/randName/) pick one nobody has:

```js
async function createSite (dir, name) {
    try {
        return await puter.hosting.create(name, dir);
    } catch (e) {
        if (e?.code !== 'conflict') throw e;
        return await puter.hosting.create(puter.randName(), dir);
    }
}
```

A name can use lowercase letters, digits and hyphens, and cannot start or end
with a hyphen. Check these
rules in your name field before calling
[`puter.hosting.create()`](/Hosting/create/).

## Remember Which Site Belongs to Which Project

When the user comes back to a project, your app needs to know whether it was
published and under which name. Save the site name with
[`puter.kv.set()`](/KV/set/), keyed by the project:

```js
await puter.kv.set(`site:${project.id}`, site.subdomain);
```

To find the site later, read it back with [`puter.kv.get()`](/KV/get/). It
returns `null` for a project that was never published:

```js
const subdomain = await puter.kv.get(`site:${project.id}`);
```

## Publish Again After Edits

A site serves whatever is in its folder, so publishing an edit means writing the
files again. There is nothing to redeploy. This `publish()` function handles
the first publish and every one after it:

```js
async function publish (project, name) {
    const dir = `sites/${project.id}`;

    await puter.fs.write(`${dir}/index.html`, renderPage(project), { createMissingParents: true });
    await puter.fs.write(`${dir}/photo.jpg`, project.photo);

    let subdomain = await puter.kv.get(`site:${project.id}`);

    if (!subdomain) {
        const site = await createSite(dir, name);
        subdomain = site.subdomain;
        await puter.kv.set(`site:${project.id}`, subdomain);
    }

    return `https://${subdomain}.puter.site`;
}
```

To list the user's sites or take one offline, see
[Manage websites](/recipes/manage-websites/).

## Notes

- To give single files a public URL, such as images or downloads, see
  [Host files online](/recipes/host-file/). One hosted folder serves every file,
  with no page or site name to manage.
