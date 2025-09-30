## Extensions - Implementing Drivers

Puter's concept of drivers has existed long before the extension system
was refined, and to keep things moving forward it has become easier to
develop Puter drivers in extensions than anywhere else in Puter's source.
If you want to build a driver, an extension is the recommended way to do it.

### What are Puter drivers?

Puter drivers are all called through the `/drivers/call` endpoint, so they
can be thought of as being "above" the HTTP layer. When a method on a driver
throws an error you will still receive a `200` HTTP status response because
the the invocation - from the HTTP layer - was successful.

A driver response follows this structure:
```json
{
    "success": true,
    "service": {
        "name": "implementation-name"
    },
    "result": "any type of value goes here",
    "metadata": {}
}
```

There exists an example driver called `hello-world`. This driver implements
a method called `greet` with the optional parameter `subject` which returns
a string greeting either `World` (default) or the specified subject.

```javascript
await puter.call('hello-world', 'no-frills', 'greet', { subject: 'Dave' });
```

Let's break it down:

#### `'hello-world'`

`'hello-world'` is the name of an "interface". An interface can be thought of
a contract of what inputs are allowed and what outputs are expected. For
example the `hello-world` interface specifies that there must be a method
called `greet` and it should return a string representing a greeting.

To add another example, an interface called `weather` specify a method called
`forcast5day` that always returns a list of 5 objects with a particular
structure.

#### `no-frills`

`'no-frills'` is a simple - "no frills" (nothing extra) - implementation of
the `hello-world` interface. All it does is return the string:
```javascript
`Hello, ${subject ?? 'World'}!`
```


#### `'greet'`

`greet` is the method being called. It's the only method on the `hello-world`
interface.

#### `{ subject: 'Dave' }`

These are the arguments to the `greet` method. The arguments specify that we
want to say "Hello" to Dave. Hopefully he doesn't ask us to open the pod bay
doors, or if he does we hopefully have extensions to add a driver interface
and driver implementation for the pod bay doors so that we can interact with
them.

### Drivers in Extensions

The `hellodriver` extension adds the `hello-world` interface like this:
```javascript
extension.on('create.interfaces', event => {
    // createInterface is the only method on this `event`
    event.createInterface('hello-world', {
        description: 'Provides methods for generating greetings',
        methods: {
            greet: {
                description: 'Returns a greeting',
                parameters: {
                    subject: {
                        type: 'string',
                        optional: true
                    },
                    locale: {
                        type: 'string',
                        optional: true
                    },
                }
            }
        }
    })
});
```

The `hellodriver` extension adds the `no-frills` implementation for
`hello-world` like this:
```javascript
extension.on('create.drivers', event => {
    event.createDriver('hello-world', 'no-frills', {
        greet ({ subject }) {
            return `Hello, ${subject ?? 'World'}!`;
        }
    });
});`
```

You can pass an instance of a class for a driver implementation as well:
```javascript
class Greeter {
    greet ({ subject }) {
        return `Hello, ${subject ?? 'World'}!`;
    }
}

extension.on('create.drivers', event => {
    event.createDriver('hello-world', 'no-frills', new Greeter());
});`
```

Instances of classes being supported
may seem to be implied by the example before this
one, but that is not the case. What's shown here is that function members
of the object passed to `createDriver` will not be "bound" (have their
`.bind()` method called with a different object as the instance variable).

