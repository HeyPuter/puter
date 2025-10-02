# `puter.item.write_url`

`puter.item.write_url` contains a URL that can be used to write to the file that was opened using your app. A simple `POST` request to the URL represented by `puter.item.write_url` will get the job done and immediately write to the file. Additionally, `puter.item.write_url` is a signed URL containing all the information needed to write to the file, so you won't need to add anything else to the request: no tokens, no file IDs, no authentication, no credentials... all you need is the data you want to write to the file.

```html
<!DOCTYPE html>
<html>
<body>
    <script>
    const url_params = new URLSearchParams(window.location.search);

    if(url_params.has('puter.item.write_url')){
        // prepare data to be sent in the POST request
        const formData = new FormData();
        formData.append('file', new File(['Hello world!'], {}));

        // send POST request to puter.item.write_url
        fetch(url_params.get('puter.item.write_url'), {
            method: 'POST',
            body: formData
        })
    }
    </script>
</body>
</html>
```