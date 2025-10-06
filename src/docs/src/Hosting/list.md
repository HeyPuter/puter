Returns an array of all subdomains in the user's subdomains that this app has access to. If the user has no subdomains, the array will be empty.

## Syntax
```js
puter.hosting.list()
```

## Parameters
None

## Return value
A `Promise` that will resolve to an array of all [`subdomain`s](/Objects/subdomain/) belonging to the user that this app has access to. 

## Examples

<strong class="example-title">Create 3 random websites and then list them</strong>

```html;hosting-list
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate 3 random subdomains
            let site_1 = puter.randName();
            let site_2 = puter.randName();
            let site_3 = puter.randName();

            // (2) Create 3 empty websites with the subdomains we generated
            await puter.hosting.create(site_1);
            await puter.hosting.create(site_2);
            await puter.hosting.create(site_3);

            // (3) Get all subdomains
            let sites = await puter.hosting.list();

            // (4) Display the names of the websites
            puter.print(sites.map(site => site.subdomain));

            // Delete all sites (cleanup)
            await puter.hosting.delete(site_1);
            await puter.hosting.delete(site_2);
            await puter.hosting.delete(site_3);
        })();
    </script>
</body>
</html>
```
