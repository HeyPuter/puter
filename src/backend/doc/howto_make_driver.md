# How to Make a Puter Driver

## What is a Driver?

A driver can be one of two things depending on what you're
talking about:
- a **driver interface** describes a general type of service
  and what its parameters and result look like.
  For example, `puter-chat-completion` is a driver interface
  for AI Chat services, and it specifies that any service
  on Puter for AI Chat needs a method called `complete` that
  accepts a JSON parameter called `messages`.
- a **driver implementation** exists when a **Service** on
  Puter implements a **trait** with the same name as a
  driver interface.

## Part 1: Choose or Create a Driver Interface

Available driver interfaces exist at this location in the repo:
[/src/backend/src/services/drivers/interfaces.js](../src/services/drivers/interfaces.js).

When creating a new Puter driver implementation, you should check
this file to see if there's an appropriate interface. We're going
to make a driver that returns greeting strings, so we can use the
existing `hello-world` interface. If there wasn't an existing
interface, it would need to be created. Let's break down this
interface:

```javascript
'hello-world': {
    description: 'A simple driver that returns a greeting.',
    methods: {
        greet: {
            description: 'Returns a greeting.',
            parameters: {
                subject: {
                    type: 'string',
                    optional: true,
                },
            },
            result: { type: 'string' },
        }
    }
},
```

The **description** describes what the interface is for. This
should be provided that both driver developers and users can
quickly identify what types of services should use it.

The **methods** object should have at least one entry, but it
may have more. The key of each entry is the name of a method;
in here we see `greet`. Each method also has a description,
a **parameters** object, and a **result** object.

The **parameters** object has an entry for each parameter that
may be passed to the method. Each entry is an object with a
`type` property specifying what values are allowed, and possibly
an `optional: true` entry.

All methods for Puter drivers use _named parameters_. There are no
positional parameters in Puter driver methods.

The **result** object specifies the type of the result. A service
called DriverService will use this to determine the response format
and headers of the response.

## Part 2: Create a Service

Creating a service is very easy, provided the service doesn't do
anything. Simply add a class to `src/backend/src/services` or into
the module of your choice (`src/backend/src/modules/<module name>`)
that looks like this:

```javascript
const BaseService = require('./BaseService')
// NOTE: the path specified ^ HERE might be different depending
//       on the location of your file.

class PrankGreetService extends BaseService {
}
```

Notice I called the service "PrankGreet". This is a good service
name because you already know what the service is likely to
implement: this service generates a greeting, but it is a greeting
that intends to play a prank on whoever is beeing greeted.

Then, register the service into a module. If you put the service
under `src/backend/src/services`, then it goes in
[CoreModule](..//src/CoreModule.js) somewhere near the end of
the `install()` method. Otherwise, it will go in the `*Module.js`
file in the module where you placed your service.

The code to register the service is two lines of code that will
look something like this:

```javascript
const { PrankGreetServie } = require('./path/to/PrankGreetServie.js');
services.registerService('prank-greet', PrankGreetServie);
```

## Part 3: Verify that the Service is Registered

It's always a good idea to verify that the service is loaded
when starting Puter. Otherwise, you might spend time trying to
determine why your code doesn't work, when in fact it's not
running at all to begin with.

To do this, we'll add an `_init` handler to the service that
logs a message after a few seconds. We wait a few seconds so that
any log noise from boot won't bury our message.

```javascript
class PrankGreetService extends BaseService {
    async _init () {
        // Wait for 5 seconds
        await new Promise(rslv => setTimeout(rslv), 5000);

        // Display a log message
        this.log.noticeme('Hello from PrankGreetService!');
    }
}
```

Typically you'll use `this.log.info('some message')` in your logs
as opposed to `this.log.noticeme(...)`, but the `noticeme` log
level is helpful when debugging.

## Part 4: Implement the Driver Interface in your Service

Now that it has been verified that the service is loaded, we can
start implementing the driver interface we chose eralier.

```javascript
class PrankGreetService extends BaseService {
    async _init () {
        // ... same as before
    }

    // Now we add this:
    static IMPLEMENTS = {
        ['hello-world']: {
            async greet ({ subject }) {
                if ( subject ) {
                    return `Hello ${subject}, tell me about updog!`;
                }
                return `Hello, tell me about updog!`;
            }
        }
    }
}
```

## Part 5: Test the Driver Implementation

We have now created the `prank-greet` implementation of `hello-world`.
Let's make a request in the browser to check it out. The example below
is a `fetch` call using `http://api.puter.localhost:4100` as the API
origin, which is the default when you're running Puter's backend locally.

Also, in this request I refer to `puter.authToken`. If you run this
snippet in the Dev Tools window of your browser from a tab with Puter
open (your local Puter, to be precise), this should contain the current
value for your auth token.

```javascript
await (await fetch("http://api.puter.localhost:4100/drivers/call", {
    "headers": {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${puter.authToken}`,
    },
    "body": JSON.stringify({
        interface: 'hello-world',
        service: 'prank-greet',
        method: 'greet',
        args: {
            subject: 'World',
        },
    }),
    "method": "POST",
})).json();
```

**You might see a permissions error!** Don't worry, this is expected;
in the next step we'll add the required permissions.

## Part 6: Permissions

In the previous step, you will only have gotten a successful response
if you're logged in as the `admin` user. If you're logged in as another
user you won't have access to the service's driver implementations be
default.

To grant permission for all users, update
[hardcoded-permissions.js](../src/data/hardcoded-permissions.js).

First, look for the constant `hardcoded_user_group_permissions`.
Whereever you see an entry for `service:hello-world:ii:hello-world`, add
the corresponding entry for your service, which will be called
```
service:prank-greet:ii:hello-world
```

To help you remember the permission string, its helpful to know that
`ii` in the string stands for "invoke interface". i.e. the scope of the
permission is under `service:prank-greet` (the `prank-greet` service)
and we want permission to invoke the interface `hello-world` on that
service.

You'll notice each entry in `hardcoded_user_group_permissions` has a value
determined by a call to the utility function `policy_perm(...)`. The policy
called `user.es` is a permissive policy for storage drivers, and we can
re-purpose it for our greeting implementor.

The policy of a permission determines behavior like rate limiting. This is
an advanced topic that is not covered in this guide.

If you want apps to be able to access the driver implementation without
explicit permission from a user, you will need to also register it in the
`default_implicit_user_app_permissions` constant. Additionally, you can
use the `implicit_user_app_permissions` constant to grant implicit
permission to the builtin Puter apps only.

Permissions to implementations on services can also be granted at runtime
to a user or group of users using the permissions API. This is beyond the
scope of this guide.

## Part 7: Verify Successful Response

If all went well, you should see the response in your console when you
try the request from Part 5. Try logging into a user other than `admin`
to verify permisison is granted.

```json
"Hello World, tell me about updog!"
```

## Part 8: Next Steps

- [Access Configuration](./services/config.md)
- [Output Logs](./services/log.md)
