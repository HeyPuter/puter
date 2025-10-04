The puter fetch API lets you securely fetch a http/https resource without being bound by CORS restrictions.

## Syntax

```js
puter.net.fetch(url)
puter.net.fetch(url, options)
```

## Parameters 

#### `url` (String) (Required)
The url of the resource to access. The URL can be either http or https.

#### `options` (Object) (optional)
A standard [RequestInit](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit) object

## Return value
A `Promise` to a `Response` object.

## Examples

```html;net-fetch
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => { 
        // Send a GET request to example.com
        const request = await puter.net.fetch("https://example.com");        

        // Get the response body as text
        const body = await request.text();

        // Print the body as a code block
        puter.print(body, { code: true });
    })()
    </script>
</body>
</html>
```
