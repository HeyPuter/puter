# Event Buses

Puter's backend has two event buses:
- Service Event Bus
- Application Event Bus

## Service Event Bus

This is a simple event bus that lives in the [Container](../../src/services/Container.js)
class. There is only one instance of **Container** and it is called the "services container".
When Puter boots, all the services registered by modules are registered into the services
container.

Services handle events from the Service Event Bus by implementing methods which are named
with the prefix `__on_`. This prefix looks a little strange at first so it's worth
breaking it down:
- `__` (two underscores) prevents collision with common method names, and also
  common conventions like beginning a method name with a single underscore
  to indicate a method that should be overridden.
- `on` is the meaningful name.
- `_`, the last underscore, is for readability, as the event name conventionally
  begins with a lowercase letter.
  
Note that you will need to use the 

Example:
```javascript
class MyService extends BaseService {
    ['__on_boot.ready'] () {
        //
    }
}
```
