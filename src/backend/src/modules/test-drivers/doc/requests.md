```javascript
blob = await (await fetch("http://api.puter.localhost:4100/drivers/call", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
      interface: 'test-image',
      method: 'get_image',
      args: {
          source_type: 'string:url:web'
      }
  }),
  "method": "POST",
})).blob();
dataurl = await new Promise((y, n) => {
    a = new FileReader();
    a.onload = _ => y(a.result);
    a.onerror = _ => n(a.error);
    a.readAsDataURL(blob)
});
URL.createObjectURL(await (await fetch("http://api.puter.localhost:4100/drivers/call", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
      interface: 'test-image',
      method: 'echo_image',
      args: {
          source: dataurl,
      }
  }),
  "method": "POST",
})).blob());
```

```javascript
await(async () => {

    blob = await (await fetch("http://api.puter.localhost:4100/drivers/call", {
        "headers": {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${puter.authToken}`,
        },
        "body": JSON.stringify({
            interface: 'test-image',
            method: 'get_image',
            args: {
                source_type: 'string:url:web'
            }
        }),
        "method": "POST",
    })).blob();

    const endpoint = 'http://api.puter.localhost:4100/drivers/call';

    const body = {
        object: {
            interface: 'test-image',
            method: 'echo_image',
            ['args.source']: {
                $: 'file',
                size: blob.size,
                type: blob.type,
            },
        },
        file: [
            blob,
        ]
    };

    const formData = new FormData();
    for ( const k in body ) {
        console.log('k', k);
        const append = v => {
            if ( v instanceof Blob ) {
                formData.append(k, v, 'filename');
            } else {
                formData.append(k, JSON.stringify(v));
            }
        };
        if ( Array.isArray(body[k]) ) {
            for ( const v of body[k] ) append(v);
        } else {
            append(body[k]);
        }
    }
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${puter.authToken}` },
        body: formData
    });
    const echo_blob = await response.blob();
    const echo_url = URL.createObjectURL(echo_blob);
    return echo_url;
})();
```