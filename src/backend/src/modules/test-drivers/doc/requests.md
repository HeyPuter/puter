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
