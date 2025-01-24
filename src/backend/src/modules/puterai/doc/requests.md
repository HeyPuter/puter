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

### Tool Use

```javascript
await puter.ai.chat('What\'s the weather like in Vancouver?', {
    tools: [
        {
            type: 'function',
            'function': {
                name: 'get_weather',
                description: 'A string describing the weather',
                parameters: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: 'city',
                        },
                    },
                    required: ['location'],
                    additionalProperties: false,
                },
                strict: true
            },
        }
    ]
})
```

```javascript
await puter.ai.chat([
    { content: `What's the weather like in Vancouver?` },
    {
            "role": "assistant",
            "content": null,
            "tool_calls": [
                {
                    "id": "call_vcfEOmDczXq7KGMirPGGiNEe",
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "arguments": "{\"location\":\"Vancouver\"}"
                    }
                }
            ],
            "refusal": null
    },
    {
        role: 'tool',
        tool_call_id: 'call_vcfEOmDczXq7KGMirPGGiNEe',
        content: 'Sunny with a chance of rain'
    },
], {
    tools: [
        {
            type: 'function',
            'function': {
                name: 'get_weather',
                description: 'A string describing the weather',
                parameters: {
                    type: 'object',
                    properties: {
                        location: {
                            type: 'string',
                            description: 'city',
                        },
                    },
                    required: ['location'],
                    additionalProperties: false,
                },
                strict: true
            },
        }
    ]
})
```
