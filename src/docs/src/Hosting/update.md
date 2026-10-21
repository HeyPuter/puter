---
title: puter.hosting.update()
description: Update a subdomain to point to a new directory.
platforms: [websites, apps, nodejs, workers]
---

Updates a subdomain to point to a new directory.

## Syntax

```js
puter.hosting.update(subdomain, dirPath)
```

## Parameters

#### `subdomain` (String) (required)

A string containing the name of the subdomain you want to update.

#### `dirPath` (String) (required)

A string containing the path to the directory you want to serve.

An app can publish its own app data directory. Publishing another directory requires `manage` access, which allows editing and sharing. Hosting serves all files under the directory publicly, including files added later. A shared directory stops being served if that access is withdrawn or its owner moves it to Trash.

When an account credential selects a different directory for an app-created site, the account takes ownership of the publication and the creating app loses its management access. This includes an account-issued access token with management authority over the new directory. Selecting the current directory preserves the creating app's access. Credentials acting through an app preserve that app's ownership.

## Return value

A `Promise` that will resolve to a [`Subdomain`](/Objects/subdomain/) object when the subdomain has been updated. If a subdomain with the given name does not exist, the promise will be rejected with an error. If the path does not exist, the promise will be rejected with an error.

## Examples

<strong class="example-title">Update a subdomain to point to a new directory</strong>

```html;hosting-update
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Create a random website
            let subdomain = puter.randName();
            const site = await puter.hosting.create(subdomain, '.')
            puter.print(`Website hosted at: ${site.subdomain}.puter.site<br>`);

            // (2) Create a random directory
            let dirName = puter.randName();
            let dir = await puter.fs.mkdir(dirName)
            puter.print(`Created directory "${dir.path}"<br>`);

            // (3) Update the site with the new random directory
            await puter.hosting.update(subdomain, dirName)
            puter.print(`Changed subdomain's root directory to "${dir.path}"<br>`);

            // (4) Delete the app (cleanup)
            await puter.hosting.delete(subdomain)
        })();
    </script>
</body>
</html>
```
