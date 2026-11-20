---
title: puter.hosting.detach()
description: Let the user remove the custom domains of a website hosted on Puter.
platforms: [websites, apps]
---

Opens a Puter dialog where the user removes custom domains from one of their websites.

The dialog lists the domains connected to the website. Removing a domain takes it off the user's account. It stops serving the website right away, and its monthly charge stops. To use the domain again, the user adds it again with [`puter.hosting.attach()`](/Hosting/attach/) and sets its DNS records.

Your app doesn't need any permission to call this method. The user makes the choice in the dialog, and your app only receives the domains they removed.

Inside Puter, the dialog is rendered by the desktop environment. On a website, a puter.com popup hosts the dialog and signs the user in first if needed. Puter's own apps on puter.com subdomains show it in a frame over the page instead, when the user is signed in to both.

## Syntax

```js
puter.hosting.detach(subdomain)
```

## Parameters

#### `subdomain` (String) (required)

The name of the website to remove domains from, such as `example` for `example.puter.site`. The website must belong to the signed-in user.

## Return value

A `Promise` that resolves to an array of [`CustomDomain`](/Objects/customdomain/) objects, one for each domain the user removed. The array is empty if the user closed the dialog without removing a domain.

To see which domains a website still has, read the `custom_domains` attribute of its [`Subdomain`](/Objects/subdomain/) object from [`puter.hosting.get()`](/Hosting/get/).

On a website that is cross-origin isolated, the popup can't send its result back to your page, so the promise resolves an empty array even if the user removes a domain in the popup.

## Errors

The promise rejects with an error whose `code` is one of the following:

- `invalid_argument` when `subdomain` is missing or empty.
- `not_available` in an environment that can't show a dialog, such as Node.js or a worker.
- `not_supported` inside a version of the Puter desktop that doesn't have the dialog.

## Examples

### Remove a custom domain from a website

```html;hosting-detach
<html>
<body>
    <button id="detach">Remove a custom domain</button>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        document.getElementById('detach').addEventListener('click', async () => {
            // (1) Pick a website of the user's that has a custom domain
            const sites = await puter.hosting.list();
            const site = sites.find((s) => s.custom_domains?.length);
            if (!site) {
                puter.print('None of your websites has a custom domain.');
                return;
            }

            // (2) Let the user remove its domains
            const removed = await puter.hosting.detach(site.subdomain);
            if (removed.length === 0) {
                puter.print('No domain was removed.');
                return;
            }
            for (const domain of removed) {
                puter.print(`Removed ${domain.hostname}<br>`);
            }
        });
    </script>
</body>
</html>
```
