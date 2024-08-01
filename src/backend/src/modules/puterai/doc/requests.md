```javascript
await (await fetch("http://api.puter.localhost:4100/drivers/call", {
    "headers": {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${puter.authToken}`,
    },
    "body": JSON.stringify({
        interface: 'puter-ocr',
        driver: 'aws-textract',
        method: 'recognize',
        args: {
            source: '~/Desktop/testocr.png',
        },
    }),
    "method": "POST",
})).json();
```

```javascript
await (await fetch("http://api.puter.localhost:4100/drivers/call", {
    "headers": {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${puter.authToken}`,
    },
    "body": JSON.stringify({
        interface: 'puter-chat-completion',
        driver: 'openai-completion',
        method: 'complete',
        args: {
            messages: [
                {
                    role: 'system',
                    content: 'Act like Spongebob'
                },
                {
                    role: 'user',
                    content: 'How do I make my code run faster?'
                },
            ]
        },
    }),
    "method": "POST",
})).json();
```

```javascript
URL.createObjectURL(await (await fetch("http://api.puter.localhost:4100/drivers/call", {
  "headers": {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${puter.authToken}`,
  },
  "body": JSON.stringify({
      interface: 'puter-image-generation',
      driver: 'openai-image-generation',
      method: 'generate',
      args: {
        prompt: 'photorealistic teapot made of swiss cheese',
      }
  }),
  "method": "POST",
})).blob());
```