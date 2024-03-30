## Entity Storage

### Chain of events

When `create` is called on an OM/ES driver:
1. The request is handled by `src/routers/drivers/call.js`
2. DriverService's `call` method is called
3. An instance of `EntityStoreImplementation` is called
4. `EntityStoreImplementation` calls the corresponding service,
   such as `es:app`, which is an instance of `EntityStoreService`
5. `EntityStoreService` calls the upstream implementation of `BaseES`
6. `BaseES` has a public method which calls the implementor method
7. The implementor method (ex: `SQLES`) handles the operation

```
/call -> DriverService
    -> EntityStoreImplementation -> EntityStoreService -> BaseES
        -> ...(storage decorators) -> SQLES
```
