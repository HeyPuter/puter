# `puter.item.metadata_url`

A simple `GET` request to the URL represented by `puter.item.metadata_url` will return the contents of the file that was opened using your app. Additionally, `puter.item.metadata_url` is a signed URL containing all the information needed to retrieve the file metadata, so you won't need to add anything else to the request: no tokens, no file IDs, no authentication, no credentials... 

```html
<!DOCTYPE html>
<html>
<body>
    <script>
    const url_params = new URLSearchParams(window.location.search);

    if(url_params.has('puter.item.metadata_url')){
        // send GET request to puter.item.metadata_url to get file metadata
        fetch(url_params.get('puter.item.metadata_url'))
            .then((response) => {
                return response.json();
            }).then(async (metadata)=>{
                // print out the metadata of the file
                console.log(metadata);
            });
    }
    </script>
</body>
```