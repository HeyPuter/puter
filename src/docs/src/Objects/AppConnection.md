---
title: AppConnection
description: Provides an interface for interaction with another app.
---

Provides an interface for interaction with another app.

## Attributes

#### `usesSDK` (Boolean)
Whether the target app is using Puter.js. If not, then some features of `AppConnection` will not be available.

## Methods

#### `on(eventName, handler)`
Listen to an event from the target app. Possible events are:

- `message` - The target app sent us a message with `postMessage()`. The handler receives the message.
- `close` - The target app has closed. The handler receives an object with an `appInstanceID` field of the closed app.

#### `off(eventName, handler)`
Remove an event listener added with `on(eventName, handler)`.

#### `postMessage(message)`
Send a message to the target app. Think of it as a more limited version of [`window.postMessage()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage). `message` can be anything that [`window.postMessage()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) would accept for its `message` parameter.

If the target app is not using the SDK, or the connection is not open, then nothing will happen.

#### `close()`
Attempt to close the target app. If you do not have permission to close it, or the target app is already closed, then nothing will happen.

An app has permission to close apps that it has launched with [`puter.ui.launchApp()`](/UI/launchApp).

## Examples

### Interacting with another app

This example demonstrates two apps, `parent` and `child`, communicating with each other over using `AppConnection`.

In order:
1. `parent` launches `child`
2. `parent` sends a message, `"Hello!"`, to `child`
3. `child` shows that message in an alert dialog.
4. `child` sends a message back.
5. `parent` receives the message and logs it.
6. `parent` closes the child app.

```html
<html>
<head>
    <title>Parent app</title>
</head>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // This app is the parent
        
        // Launch child (1)
        const child = await puter.ui.launchApp('child');
        
        // Listen to messages from the child app. (5)
        child.on('message', msg => {
            console.log('Parent app received a message from child:', msg);
            console.log('Closing child app.');
            
            // Close the child (6)
            child.close();
        });
        
        // Send a message to the child (2)
        child.postMessage('Hello!');
    </script>
</body>
</html>

<!------------------->

<html>
<head>
    <title>Child app</title>
</head>
<body>
<script src="https://js.puter.com/v2/"></script>
<script>
    // This app is the child
    
    // Get a connection to our parent.
    const parent = puter.ui.parentApp();
    if (!parent) {
        // We were not launched by the parent.
        // For this example, we'll just exit.
        puter.exit();
    } else {
        // We were launched by the parent, and can communicate with it.
        
        // Any time we get a message from the parent, show it in an alert dialog. (3)
        parent.on('message', msg => {
            puter.ui.alert(msg);
            
            // Send a message back (4)
            // Messages can be any JS object that can be cloned.
            parent.postMessage({
                name: 'Nyan Cat',
                age: 13
            });
        });
    }
</script>
</body>
</html>
```

### Single app with multiple windows

Multi-window applications can also be implemented with a single app, by launching copies of itself that check if they have a parent and wait for instructions from it.

In this example, a parent app (with the name `traffic-light`) launches three children that display the different colors of a traffic light.

```html
<html>
<head>
    <title>Traffic light</title>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        const parent = puter.ui.parentApp();
        if (parent) {
            // We have a parent, so wait for it to tell us what to do.
            // In this example, just change the background color and display a message.
            parent.on('message', msg => {
                document.bgColor = msg.color;
                document.body.innerText = msg.text;
            });
        } else {
            // `parent` is null, so we are the instance that should create and direct the child apps.
            const trafficLight = [
                {
                    color: 'red',
                    text: 'STOP',
                }, {
                    color: 'yellow',
                    text: 'WAIT',
                }, {
                    color: 'green',
                    text: 'GO',
                },
            ];
            for (const data of trafficLight) {
                // Launch a child app for each task.
                puter.ui.launchApp('traffic-light').then(child => {
                    child.postMessage(data);
                });
            }
        }
    </script>
</head>
</html>
```

