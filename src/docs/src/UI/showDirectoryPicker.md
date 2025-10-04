Presents the user with a directory picker dialog allowing them to pick a directory from their Puter cloud storage.

## Syntax
```js
puter.ui.showDirectoryPicker()
puter.ui.showDirectoryPicker(options)
```

## Parameters

#### `options` (optional)
A set of key/value pairs that configure the directory picker dialog.
* `multiple` (Boolean): if set to `true`, user will be able to select multiple directories. Default is `false`.

## Return value 
A `Promise` that resolves to either one <code>FSItem</code> or an array of <code>FSItem</code> objects, depending on how many directories were selected by the user. 

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>

    <button id="open-directory">Open directory</button>

    <h1 id="directory-name"></h1>
    <pre><code id="directory-content"></code></pre>

    <script>
        document.getElementById('open-directory').addEventListener('click', ()=>{
            puter.ui.showDirectoryPicker().then(async (directory)=>{
                // print directory name
                document.getElementById('directory-name').innerHTML = directory.name;
                // print directory content
                const children = await directory.readdir();
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
        });
    </script>
</body>
</html>
```