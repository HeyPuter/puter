---
title: Build a Multi-Page Website
description: "Learn how to publish a website with several pages, a shared assets folder and a custom 404 page with Puter.js, with links that work on every page."
tags: [hosting, fs]
order: 58
---

A one-page site is a single `index.html`. As soon as a site has a few pages, an
about page, a blog and some images, you need to decide where each file goes and
how the pages link to each other and to the shared files.

A site on Puter serves a folder as it is, like any static host. This recipe
covers how its paths map to URLs, how to write links that work from every
page, and what the site shows for a page that does not exist.

## Lay Out the Folder

Give each page its own folder with an `index.html` in it, and keep the files
every page uses in an `assets` folder:

```
my-site/
  index.html
  404.html
  about/
    index.html
  blog/
    index.html
    first-post/
      index.html
  assets/
    style.css
    logo.png
```

A request for a folder is answered with that folder's `index.html`, so these
files get short addresses:

| File | URL |
| --- | --- |
| `index.html` | `/` |
| `about/index.html` | `/about/` |
| `blog/first-post/index.html` | `/blog/first-post/` |
| `assets/style.css` | `/assets/style.css` |

A file named `about.html` would only be served at `/about.html`. The site does
not drop the `.html` from addresses, so use folders when you want URLs without
it.

## Write the Files

Write each page with [`puter.fs.write()`](/FS/write/). `createMissingParents`
makes the folders as it goes:

```js
const dir = 'my-site';

function page(title, body) {
    return `<!doctype html>
<html>
<head>
    <title>${title}</title>
    <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
    <nav>
        <a href="/"><img src="/assets/logo.png" alt="Home"></a>
        <a href="/about/">About</a>
        <a href="/blog/">Blog</a>
    </nav>
    ${body}
</body>
</html>`;
}

const files = {
    'index.html': page('Home', '<h1>Welcome</h1>'),
    'about/index.html': page('About', '<h1>About me</h1>'),
    'blog/index.html': page('Blog', '<a href="/blog/first-post/">My first post</a>'),
    'blog/first-post/index.html': page('My first post', '<h1>My first post</h1>'),
    '404.html': page('Not found', '<h1>This page does not exist</h1>'),
    'assets/style.css': 'body { font-family: sans-serif; max-width: 40rem; margin: auto; }',
};

for (const [path, content] of Object.entries(files)) {
    await puter.fs.write(`${dir}/${path}`, content, { createMissingParents: true });
}
await puter.fs.write(`${dir}/assets/logo.png`, logoBlob);

const site = await puter.hosting.create(puter.randName(), dir);
```

To publish many files in one call, such as a folder the user dropped onto the
page, use [`puter.fs.upload()`](/FS/upload/) instead.

## Link From the Site Root

Every link above starts with `/`, such as `/assets/style.css`. A link like that
is read from the site's root, so it points to the same file from every page.

A link without the `/`, such as `assets/style.css`, is read from the page's
own address instead, and that address depends on how the visitor got there.
`/about/` and `/about` both show `about/index.html`, but the browser treats them
as different folders:

| Page address | `assets/style.css` loads | `/assets/style.css` loads |
| --- | --- | --- |
| `/` | `/assets/style.css` | `/assets/style.css` |
| `/about/` | `/about/assets/style.css` (missing) | `/assets/style.css` |
| `/about` | `/assets/style.css` | `/assets/style.css` |

So a page with relative links can look right when you test it and lose its
styles when someone links to it with or without the trailing `/`. Links that
start with `/` do not have this problem.

## Add a 404 Page

A request for a path with no file gets a default 404 page. To show your own,
add a `.puter_site_config` file at the top of the folder that points to it:

```js
await puter.fs.write(`${dir}/.puter_site_config`, JSON.stringify({
    errors: {
        404: { file: '/404.html' },
    },
}));
```

The page is sent with a `404` status, so search engines know it is not a real
page. The `.puter_site_config` file itself is never served to visitors.

The site reads this file again at most once a minute, so give a change a minute
before you test it. If the file has a mistake, such as broken JSON, the site
keeps working and shows the default 404 page. See
[Site configuration](/site-config/) for the full format.

For a single-page app, such as one built with React Router, point the 404 rule
at `/index.html` with `"status": 200` instead, so every path loads the app.

## Choose Which Folder Is Published

When your code runs as a Puter app, a path that does not start with `/` or `~`,
such as `my-site`, points into the app's own folder in the user's account.
[`puter.fs.write()`](/FS/write/) and
[`puter.hosting.create()`](/Hosting/create/) read paths the same way, so a site
created with `'my-site'` serves the folder you just wrote.

To publish a folder somewhere else in the user's account, pass a full path.
Your app needs write access to a folder outside its own before it can publish
it, which [`puter.perms.request()`](/Perms/request/) asks the user for. It
resolves to the folder's full path:

```js
const documents = await puter.perms.request('folder', { name: 'Documents', access: 'write' });

if (documents) {
    await puter.hosting.create('grace-portfolio', `${documents}/my-site`);
}
```

[`puter.hosting.create()`](/Hosting/create/) also takes an object,
`{ subdomain, root_dir }`. Its `root_dir` is not read from the app's folder, so
it must always be a full path:

```js
await puter.hosting.create({ subdomain: 'grace-portfolio', root_dir: `${documents}/my-site` });
```

See [Ask for access](/recipes/perms-ask-for-access/) for the other folders an
app can ask for.

Everything in the published folder is public, including files you add later,
so do not publish a folder that holds anything private.
