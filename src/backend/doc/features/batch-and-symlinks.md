# Batch and Symlinks

2024-10-08

### Batch and Symlinks

All filesystem operations will eventually be available through batch requests.
Since batch requests can also handle the cases for single files, it seems silly
to support those endpoints too, so eventually most calls will be done through
`/batch`. Puter's legacy filesystem endpoints will always be supported, but a
future `api.___/fs/v2.0` urlspace for the filesystem API might not include them.

This is batch:

```javascript
await (async () => {
    const endpoint = 'http://api.puter.localhost:4100/batch';

    const ops = [ 
      {
        op: 'mkdir',
        path: '/default_user/Desktop/some-dir',
      },
      {
        op: 'write',
        path: '/default_user/Desktop/some-file.txt',
      }
    ];

    const blob = new Blob(["12345678"], { type: 'text/plain' });
    const formData = new FormData();
    for ( const op of ops ) {
      formData.append('operation', JSON.stringify(op));
    }
    formData.append('fileinfo', JSON.stringify({
        name: 'file.txt',
        size: 8,
        mime: 'text/plain',
    }));
    formData.append('file', blob, 'hello.txt');

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${puter.authToken}` },
        body: formData
    });
    return await response.json();
})();
```
Symlinks are also created via `/batch`

```javascript
await (async () => {
    const endpoint = 'http://api.puter.localhost:4100/batch';

    const ops = [ 
      {
        op: 'symlink',
        path: '~/Desktop',
        name: 'link',
        target: '/bb/Desktop/some'
      },
    ];

    const formData = new FormData();
    for ( const op of ops ) {
      formData.append('operation', JSON.stringify(op));
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${puter.authToken}` },
        body: formData
    });
    return await response.json();
})();
```
