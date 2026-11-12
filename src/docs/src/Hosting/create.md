---
title: puter.hosting.create()
description: Create and host a website from a directory on Puter.
platforms: [websites, apps, nodejs, workers]
---

Creates a new subdomain that will be served by the hosting service.

You must specify a path to a directory that will be served by the subdomain.

## Syntax

```js
puter.hosting.create(subdomain, dirPath)
puter.hosting.create(options)
```

## Parameters

#### `subdomain` (String) (required)

A string containing the name of the subdomain you want to create.

#### `dirPath` (String) (required)

A string containing the path to the directory you want to serve.

The directory must be one you own. Hosting serves everything under it publicly, including files added later, so a directory someone shared with you can only be published if they gave you `manage` access — [`share()`](/FS/share/) calls that level "Can edit & share". That access is also what keeps the site up: if the owner withdraws it, or moves the directory to their trash, the site stops being served.

#### `options` (Object) (optional)

Alternative way to create hosting via options.

| Option | Type | Description |
|--------|------|-------------|
| `subdomain` | `String` | Name of the subdomain you want to create. |
| `root_dir` | `String` | Required. Absolute path to the directory you want to serve. Unlike `dirPath`, this value is not resolved against the app's root directory, so it must be an absolute path. |

## Return value

A `Promise` that will resolve to a [`Subdomain`](/Objects/subdomain/) object when the subdomain has been created.

## Errors

If a subdomain with the given name already exists, the promise will be rejected with an error. If the path does not exist, the promise will be rejected with an error.

## Cached and uncached URLs

Each site you create is available at two URLs. In most cases, you want `<subdomain>.puter.site`. It's served through a CDN and cached, so it loads fast.

If you need your files exactly as they are right now, without caching, use `<subdomain>.puter.host`. It isn't served through a CDN or cached, so it can be slower, but it always returns the latest version of your files.

```
<subdomain>.puter.site   // cached, use this in most cases
<subdomain>.puter.host   // uncached, returns the latest files
```

## Examples

### Create a simple website displaying "Hello world!"

```html;hosting-create
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random directory
            let dirName = puter.randName();
            await puter.fs.mkdir(dirName)

            // (2) Create 'index.html' in the directory with the contents "Hello, world!"
            await puter.fs.write(`${dirName}/index.html`, '<h1>Hello, world!</h1>');

            // (3) Host the directory under a random subdomain
            let subdomain = puter.randName();
            const site = await puter.hosting.create(subdomain, dirName)

            puter.print(`Website hosted at: <a href="https://${site.subdomain}.puter.site" target="_blank">https://${site.subdomain}.puter.site</a>`);
        })();
    </script>
</body>
</html>
```
