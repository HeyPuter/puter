# `puter.readAppDataFile()`
Reads a file from the app's data directory.

## Syntax
```js
puter.readAppDataFile(path)
puter.readAppDataFile(path, callback)
```

## Parameters
#### `path` (String)
The relative path to the file you would like to read from the app's data directory.

#### `callback` (Function)
A callback function that will be called with the file that was just read. If the file does not exist, the callback will be called with `null`.

## Return value 
A `Promise` that resolves to a <code>CloudItem</code>. 

## Examples

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <script>
        // First save an Example.txt file to the user's AppData folder
        puter.saveToAppData('Example.txt', "Hello world! I'm the content of this file.").then(()=>{
            // Now read Example.txt from the user's AppData folder, 
            puter.readAppDataFile('Example.txt').then((item)=>{
                console.log(item);
            });
        })
    </script>
</body>
</html>
```