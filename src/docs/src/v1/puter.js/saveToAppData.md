# `puter.saveToAppData()`
A helper function that allows you to quickly save a file to the user's AppData folder belonging to this app. The AppData folder is a hidden folder in Puter that contains application data for the current user. It is located in the user's home directory. The AppData folder is not shared with other users.

## Syntax
```js
puter.saveToAppData(filename)
puter.saveToAppData(filename, data)
puter.saveToAppData(filename, url_object)
```

## Parameters
#### `filename` (String)
The name of the file to save. If the file already exists, the name will be appended with a number to make it unique.

#### `data`
The content of the file to save. If not provided, the file will be created empty.

## Examples

<a href="https://puter.com/app/savetoappdata-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=saveToAppData&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3D610f8dbc-6204-43d6-b770-3f0580661808%26expires%3D10001673659473%26signature%3D3827148ccf43f200dc48ecb976a14f2667957103fff93df2ad3765f19e9551cc" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // Will save Example.txt to the user's AppData folder
        puter.saveToAppData('Example.txt', "Hello world! I'm the content of this file.");
    </script>
</body>
</html>
```