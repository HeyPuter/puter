---
title: subscription.off()
description: End a subscription created with puter.events.onLocal().
platforms: [websites, apps, nodejs]
---

<div class="info">The Events API is in beta. Event shapes, limits, and behavior may change between releases.</div>

Ends a subscription returned by [`puter.events.onLocal()`](/Events/onLocal/). The handler stops being called immediately, and the server is told when there is still a connection to tell it over.

When the last subscription on this client ends, the events connection closes with it.

## Syntax
```js
subscription.off()
```

## Parameters
None.

## Return value
A `Promise` that resolves when the subscription is gone. It never rejects: calling `off()` twice, or after the connection has already dropped, is a no-op — a subscription does not outlive its connection, so there is nothing left to fail at.

## Examples

<strong class="example-title">Watch a directory, then stop watching it</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const dir = `~/${puter.randName()}`;
            await puter.fs.mkdir(dir);

            const sub = await puter.events.onLocal(`fs:${dir}`, ({ event }) => {
                puter.print(`${event.op}: ${event.path}<br>`);
            });

            await puter.fs.write(`${dir}/first.txt`, 'delivered');

            // Give the first change time to arrive, then stop listening
            setTimeout(async () => {
                await sub.off();
                puter.print('stopped listening<br>');

                // Nothing below is delivered
                await puter.fs.write(`${dir}/second.txt`, 'not delivered');
            }, 2000);
        })();
    </script>
</body>
</html>
```
