---
title: Manage Websites
description: "Learn how to list, look up, repoint and delete the websites your app has published with Puter.js."
tags: [hosting]
order: 56
---

Once your app has [published a website](/recipes/add-website-publishing/), the
[hosting API](/Hosting/) lets it find that site again, change which folder it
serves, and take it offline. Each operation is one call that takes the site's
name.

This is what a site dashboard needs: a list of sites, a page per site, and
buttons to release a new version or delete it.

## List Sites

To show the user's sites, call [`puter.hosting.list()`](/Hosting/list/):

```js
const sites = await puter.hosting.list();

for (const site of sites) {
    console.log(`https://${site.subdomain}.puter.site`, site.root_dir?.path);
}
```

Each entry is a [`Subdomain`](/Objects/subdomain/) object. `root_dir` is the
folder it serves, and is `null` when that folder no longer exists.

When your code runs as a Puter app, the list only has the sites that app
created. Sites the user published from somewhere else are left out, and the
other hosting calls cannot change them either.

## Get One Site

To look up a single site by name, call [`puter.hosting.get()`](/Hosting/get/):

```js
const site = await puter.hosting.get('grace-portfolio');

site.subdomain;       // 'grace-portfolio'
site.root_dir.path;   // '/grace/my-site'
```

It rejects when there is no site with that name, or when it belongs to someone
else. Catch the error to use it as an existence check:

```js
const exists = await puter.hosting.get('grace-portfolio').then(() => true, () => false);
```

## Serve a Different Folder

To point a site at another folder, call
[`puter.hosting.update()`](/Hosting/update/) with the name and the new folder.
The name and URL stay the same:

```js
await puter.fs.mkdir('my-site-v2');
await puter.fs.write('my-site-v2/index.html', '<h1>Version 2</h1>');

await puter.hosting.update('grace-portfolio', 'my-site-v2');
```

This is a clean way to release a new version. Build it in a fresh folder while
the old one keeps serving, then switch in one call. To roll back, point the
site at the old folder again.

## Delete a Site

To take a site offline, call [`puter.hosting.delete()`](/Hosting/delete/) with
its name:

```js
await puter.hosting.delete('grace-portfolio');
```

The address stops answering. The folder and its files stay in the user's
account, so nothing is lost and you can publish them again later.
