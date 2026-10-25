---
title: Build a Public Upload Gallery
description: "Learn how to build a gallery where users post images from your app with Puter.js. Each image is hosted from the user's own account, and a serverless worker keeps the shared list."
tags: [workers, hosting, fs, kv, auth]
order: 59
---

A gallery where users post images needs three things: somewhere to keep each
file, a public link to show it, and one list of every post that all users can
see. Usually that means a storage bucket, a CDN and a database, all paid for by
you.

With Puter, each user keeps their own images. Your app writes the image to the
user's account and [hosts it](/Hosting/) there, so the user pays for its storage
and for the traffic when others view it, under the
[User-Pays model](/user-pays-model/). The only thing your app shares is the list
of links. A [serverless worker](/Workers/) keeps that list in your
[key-value store](/KV/) and checks every link before adding it.

## Host the User's Images

Each user gets one site for their gallery images, created the first time they
post. Save its name with [`puter.kv.set()`](/KV/set/) so the next post reuses
it:

```js
async function getGallerySite() {
    let site = await puter.kv.get('gallery:site');
    if (!site) {
        site = (await puter.hosting.create(puter.randName(), 'gallery')).subdomain;
        await puter.kv.set('gallery:site', site);
    }
    return site;
}
```

`gallery` is a relative path, so it is a folder inside your app's own folder in
the user's account. Nothing else the user has is put online.
[`puter.randName()`](/Utils/randName/) picks a site name that is unlikely to be
taken. Creating a site needs a Puter account with a verified email address.

## Upload an Image

Write the file into the hosted folder with [`puter.fs.write()`](/FS/write/). It
is online as soon as the write finishes:

```js
const TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

async function uploadImage(file) {
    const ext = TYPES[file.type];
    if (!ext) {
        throw new Error('only PNG, JPEG, WebP and GIF images are allowed');
    }

    const name = `${crypto.randomUUID()}.${ext}`;
    await puter.fs.write(`gallery/${name}`, file, { createMissingParents: true });

    const site = await getGallerySite();
    return `https://${site}.puter.site/${name}`;
}
```

The file is written before `getGallerySite()` runs, because a site can only
point at a folder that exists. `createMissingParents` creates the `gallery`
folder on the first upload.

The file gets a name your app picks, and its extension comes from the `TYPES`
table. The site serves each file by its extension, so an upload can't turn into
an HTML page. SVG is left out for the same reason, since an SVG file can run
scripts.

## Add the Link to the Gallery

The worker owns the shared list. Your app only sends it the link. Since anyone
can call the worker, it doesn't trust the link. It makes two checks before
adding it:

1. **The site belongs to the caller.** [`puter.hosting.get()`](/Hosting/get/)
   on `user.puter` rejects for a site the user doesn't own. Because the user
   calls the worker from your app, it also rejects sites your app didn't create.
2. **The link is an image that is online.** A `HEAD` request returns the file's
   type without downloading it.

```js
// gallery.js
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const HOST_SUFFIX = '.puter.site';

function error(status, message) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

router.post('/images', async ({ request, user }) => {
    if (!user) {
        return error(401, 'sign in required');
    }

    let url;
    try {
        url = new URL((await request.json()).url);
    } catch {
        return error(400, 'url is required');
    }

    const site = url.hostname.slice(0, -HOST_SUFFIX.length);
    if (url.protocol !== 'https:' || !url.hostname.endsWith(HOST_SUFFIX) || site.includes('.')) {
        return error(400, 'url must be a Puter site');
    }

    try {
        await user.puter.hosting.get(site);
    } catch {
        return error(403, 'that site is not yours');
    }

    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok || !TYPES.includes(res.headers.get('Content-Type'))) {
        return error(400, 'url must be an image that is online');
    }

    const { username } = await user.puter.getUser();
    const image = { id: crypto.randomUUID(), url: url.href, username, at: Date.now() };
    await me.puter.kv.set(`gallery:${image.id}`, image);
    return image;
});
```

The entry is written with `me.puter`, which is your own account, so every user
adds to the same list. It holds only the link and who posted it, never the image.

See [Handle errors in a worker](/recipes/handle-worker-errors/) for more on the
`error()` helper.

## List the Images

Anyone can read the gallery, so this route doesn't need a `user`:

```js
router.get('/images', async () => {
    const rows = await me.puter.kv.list('gallery:', true);
    return rows
        .map(row => row.value)
        .sort((a, b) => b.at - a.at);
});
```

For a gallery with thousands of images, read one page at a time. See
[Store a large collection](/recipes/store-large-collection/).

## Remove an Image

Users can take their own images out of the gallery, and you can take out any of
them:

```js
const OWNER = 'grace';

router.delete('/images/:id', async ({ params, user }) => {
    if (!user) {
        return error(401, 'sign in required');
    }

    const image = await me.puter.kv.get(`gallery:${params.id}`);
    if (!image) {
        return error(404, 'not found');
    }

    const { username } = await user.puter.getUser();
    if (username !== image.username && username !== OWNER) {
        return error(403, 'you can only remove your own images');
    }

    await me.puter.kv.del(`gallery:${params.id}`);
    return { removed: params.id };
});
```

This removes the entry, not the file, which is in the user's account. To delete
the file too, the app calls [`puter.fs.delete()`](/FS/delete/) on its path after
removing the entry, and the link stops working.

## Deploy the Worker

Save `gallery.js` to your Puter account and create the worker once, which gives
it an address such as `https://gallery-api.puter.work`. See
[deployment](/Workers/#deployment) for the steps.

## Put It Together in Your App

Upload the image, then send its link to the worker with
[`puter.workers.exec()`](/Workers/exec/). It works like `fetch()`, sends the
user's session along as `user`, and asks the user to sign in first if they
haven't:

```js
const API = 'https://gallery-api.puter.work';

async function postImage(file) {
    const url = await uploadImage(file);

    const res = await puter.workers.exec(`${API}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    if (!res.ok) {
        throw new Error((await res.json()).error);
    }
    return await res.json();
}

async function loadGallery() {
    return await (await fetch(`${API}/images`)).json();
    // [ { id: '7f3c…', url: 'https://quiet-river-4821.puter.site/1b9e….png',
    //     username: 'grace', at: 1788827048741 }, … ]
}
```

Reading the gallery doesn't need a session, so a plain `fetch()` is enough there.
Show each image with an `<img>` whose `src` is its `url`.

## Notes

- You pay only for the small list entries. Anyone signed in can still add them,
  so limit how often one user can post. See
  [Keep an API key secret](/recipes/keep-api-key-secret/) for a per-user limit.
- The image stays under the user's control. If they delete the file or the
  site, the link stops working. Hide images that fail to load, or check the
  links again from time to time.
