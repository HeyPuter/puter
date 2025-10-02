# `puter.item.name`

The name of the file that was opened using your app. There are different ways users can open files through apps: double-clicking on the, choosing your app via the 'Open With...' submenu, dragging and dropping files on your app's icon. Regardless of the method used, the name is passed to your app using the `puter.item.name` URL parameter. The following example demonstrates how you can retrieve the item name from the URL.

```html
<!DOCTYPE html>
<html>
<body>
    <script>
    const url_params = new URLSearchParams(window.location.search);

    if(url_params.has('puter.item.name')){
        // will print the name of the file that was opened.
        console.log(url_params.get('puter.item.name'));
    }
    </script>
</body>
</html>
```