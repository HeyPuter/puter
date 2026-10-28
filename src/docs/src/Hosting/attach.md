---
title: puter.hosting.attach()
description: Let the user connect one of their own domains to a website hosted on Puter.
platforms: [websites, apps]
---

Opens a Puter dialog where the user connects a domain they own, such as `www.example.com`, to one of their websites. In the dialog, the user can pick a domain already on their account or add a new one. A domain the user picks that currently serves another of their websites moves to this one.

When the user adds a new domain, the dialog shows the DNS records to set at their DNS provider. The domain starts serving the website once those records are in place, usually within a few minutes.

Your app doesn't need any permission to call this method. The user makes the choice in the dialog, and your app only receives the domain they chose. Custom domains are billed to the user's Puter account, and the dialog shows the price before the user adds one.

Inside Puter, the dialog is rendered by the desktop environment. On a website, a puter.com popup hosts the dialog and signs the user in first if needed.

## Syntax

```js
puter.hosting.attach(subdomain)
```

## Parameters

#### `subdomain` (String) (required)

The name of the website to connect a domain to, such as `example` for `example.puter.site`. The website must belong to the signed-in user.

## Return value

A `Promise` that resolves to a [`CustomDomain`](/Objects/customdomain/) object for the domain the user chose, or `null` if the user closed the dialog without choosing one.

A newly added domain resolves with `status` set to `pending`. Its `records` list the DNS records the user still has to set.

On a website that is cross-origin isolated, the popup can't send its result back to your page, so the promise resolves `null` even if the user goes on to connect a domain in the popup.

The promise rejects with an error whose `code` is one of the following:

- `invalid_argument` when `subdomain` is missing or empty.
- `not_available` in an environment that can't show a dialog, such as Node.js or a worker.
- `not_supported` inside a version of the Puter desktop that doesn't have the dialog.

## Examples

<strong class="example-title">Connect a custom domain to a website</strong>

```html;hosting-attach
<html>
<body>
    <button id="attach">Use my own domain</button>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        document.getElementById('attach').addEventListener('click', async () => {
            // (1) Create a website to connect the domain to
            const site = await puter.hosting.create(puter.randName(), '.');

            // (2) Let the user pick or add a domain for it
            const domain = await puter.hosting.attach(site.subdomain);
            if (!domain) {
                puter.print('No domain was chosen.');
                return;
            }

            puter.print(`${domain.hostname} is ${domain.status}.<br>`);
            for (const record of domain.records) {
                puter.print(`${record.type} ${record.name} → ${record.value}<br>`);
            }
        });
    </script>
</body>
</html>
```
