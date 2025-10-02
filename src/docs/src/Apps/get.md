Returns an app with the given name. If the app does not exist, the promise will be rejected.

## Syntax
```js
puter.apps.get(name)
puter.apps.get(name, options)
```

## Parameters
#### `name` (required)
The name of the app to get.

### options (optional)

An object containing the following properties:

- `stats_period` (optional): A string representing the period for which to get the user and open count. Possible values are `today`, `yesterday`, `7d`, `30d`, `this_month`, `last_month`, `this_year`, `last_year`, `month_to_date`, `year_to_date`, `last_12_months`. Default is `all` (all time).

- `icon_size` (optional): An integer representing the size of the icons to return. Possible values are `null`, `16`, `32`, `64`, `128`, `256`, and `512`. Default is `null` (the original size).

## Return value
A `Promise` that will resolve to the [`app`](/Objects/app/) with the given name.

## Examples

<strong class="example-title">Create a random app then get it</strong>

```html;app-get
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            // (1) Generate a random app name to make sure it doesn't already exist
            let appName = puter.randName();

            // (2) Create the app
            await puter.apps.create(appName, "https://example.com");
            puter.print(`"${appName}" created<br>`);

            // (3) Retrieve the app using get()
            let app = await puter.apps.get(appName);
            puter.print(`"${appName}" retrieved using get(): id: ${app.uid}<br>`);

            // (4) Delete the app (cleanup)
            await puter.apps.delete(appName);
        })();
    </script>
</body>
</html>
```
