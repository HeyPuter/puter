# `puter.showDirectoryPicker()`
Presents the user with a directory picker dialog allowing them to pick a directory from their Puter cloud storage.

## Syntax
```js
puter.showDirectoryPicker()
puter.showDirectoryPicker(options)
```

## Parameters

#### `options` (optional)
A set of key/value pairs that configure the directory picker dialog.
* `multiple` (Boolean): if set to `true`, user will be able to select multiple directories. Default is `false`.

## Return value 
A `Promise` that resolves to either one <code>CloudItem</code> or an array of <code>CloudItem</code> objects, depending on how many directories were selected by the user. 

## Examples

<a href="https://puter.com/app/showdirectorypicker-example" target="_blank" class="example-code-link">▶︎ Run</a>
<span class="bull">&bull;</span>
<a href="https://puter.com/?name=showDirectoryPicker&is_dir=1&download=https%3A%2F%2Fapi.puter.com%2Ffile%3Fuid%3Db7fe86b0-5d56-4fdb-8905-2b533eb3f097%26expires%3D10001673593696%26signature%3D3d802a957435893a854a89e86adc1848b9db15e348e87412bb259c23df42f286" target="_blank" class="example-code-link">⤓ Download</a>

```html
<!DOCTYPE html>
<html>
<head>
    <script src="https://js.puter.com/v1/"></script>
</head>
<body>
    <h1 id="directory-name"></h1>
    <pre><code id="directory-content"></code></pre>

    <script>
        puter.showDirectoryPicker().then(async (directory)=>{
            // print directory name
            document.getElementById('directory-name').innerHTML = directory.name;
            // print directory content
            const children = await directory.children();
            if(children.length){
                let content = '';
                for(let child of children){
                    content += child.name + '\n';
                }
                document.getElementById('directory-content').innerText = content;
            }else{
                document.getElementById('directory-content').innerText = 'Empty directory';
            }
        });
    </script>
</body>
</html>
```