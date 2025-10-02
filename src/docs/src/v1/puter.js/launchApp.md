# `puter.launchApp()`
Allows you to dynamically launch another app from within your app.

## Syntax
```js
puter.launchApp()
puter.launchApp(appName)
puter.launchApp(appName, args)
puter.launchApp(args)
```

## Parameters
#### `appName` (String)
Name of the app. If not provided, a new instance of the current app will be launched.

#### `args` (Object)
Arguments to pass to the app. If `appName` is not provided, these arguments will be passed to the current app.

## Return value 
A `Promise` that will resolve once the app is launched.

## Examples

<a href="https://puter.com/app/launchapp-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=launchApp&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D5388c029-6205-4912-a654-0f37fa6bbf97%26expires%3D10001673402311%26signature%3D4ca20cecd2999b1b3c09be5fbda98d47ea2b686bb9fc19f5145840d0fc9af1f7" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // launches the Editor app
        puter.launchApp('editor');
    </script>
</body>
</html>
```