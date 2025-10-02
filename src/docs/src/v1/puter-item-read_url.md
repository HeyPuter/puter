# `puter.item.read_url`

A simple `GET` request to the URL represented by `puter.item.read_url` will return the contents of the file that was opened using your app. Additionally, `puter.item.read_url` is a signed URL containing all the information needed to retrieve the file, so you won't need to add anything else to the request: no tokens, no file IDs, no authentication, no credentials... 

```html
<!DOCTYPE html>
<html>
<body>
    <script>
    const url_params = new URLSearchParams(window.location.search);

    if(url_params.has('puter.item.read_url')){
        // send GET request to puter.item.read_url to get file content
        fetch(url_params.get('puter.item.read_url'))
            .then((response) => {
                return response.blob();
            }).then(async (blob)=>{
                // print out the contents of the file
                console.log(await blob.text());
            });
    }
    </script>
</body>
</html>
```