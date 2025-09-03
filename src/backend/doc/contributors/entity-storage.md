# Entity Storage Internals

## 1. Overview

Entity Storage is a generic, CRUD-like system used in the Puter backend to manage core data types. It provides a standardized service architecture for creating, reading, updating, deleting, and querying entities such as `apps`, `subdomains`, and `notifications`. The system is designed to be extensible, using a generic service that is configured for each specific entity type during system initialization.

## 2. Core Components

The Entity Storage system is comprised of several key services and modules that work together. Here is a high-level overview of each component and its role in the process:

* **Client-side Module (e.g., `Apps.js`)**: The starting point of a request. This is the public-facing API that developers use. It abstracts the internal complexity and calls the backend driver system using a legacy interface name (e.g., `'puter-apps'`).

* **`DriverService.js`**: The central router and translator. It receives requests from client-side modules, translates legacy interface names into their modern equivalents (e.g., `'puter-apps'` -> `'crud-q'`), and routes the call to the appropriate backend service.

* **`EntityStoreInterfaceService.js`**: Defines the "contract" for entity storage. It registers the modern `crud-q` interface and specifies the exact methods (e.g., `create`, `read`, `update`) that any implementing service must provide.

* **`EntityStoreService.js`**: The generic "worker" class that implements the `crud-q` contract. It contains the core logic for handling entity operations, which it delegates to an underlying data provider (the "upstream").

* **`CoreModule.js`**: The "factory" or configuration hub. This module is responsible for creating and registering specific instances of the generic `EntityStoreService` for each entity type (`app`, `subdomain`, `notification`) during application startup.

## 3. End-to-End Workflow Example

To understand how the components work together, let's trace the journey of a single API call, such as creating a new app.

1. The Client Call (`Apps.js`)

The process begins in a client-side module like `Apps.js`. A developer calls a user-friendly function, for example, `puter.apps.create({...})`. Internally, this function makes a call to the backend driver system using a legacy interface name.

```javascript
// Inside Apps.js
return await utils.make_driver_method([...], 'puter-apps', undefined, 'create').call(this, options);

2. The Translation (DriverService.js)

The DriverService receives the request with the interface name 'puter-apps'. Inside its _call method, it uses a lookup table (iface_to_iface) to translate this legacy name into the modern, generic interface name: 'crud-q'. This allows the backend to use a single, standardized interface for all entity types.

// Inside DriverService.js
const iface_to_iface = {
    'puter-apps': 'crud-q',
    'puter-subdomains': 'crud-q',
    'puter-notifications': 'crud-q',
}
iface = iface_to_iface[iface] ?? iface; // 'iface' is now 'crud-q'

Of course. Here is the complete and final documentation in a single Markdown block.

You can replace the entire content of your entity-storage.md file with this.

Markdown

# Entity Storage Internals

## 1. Overview

Entity Storage is a generic, CRUD-like system used in the Puter backend to manage core data types. It provides a standardized service architecture for creating, reading, updating, deleting, and querying entities such as `apps`, `subdomains`, and `notifications`. The system is designed to be extensible, using a generic service that is configured for each specific entity type during system initialization.

## 2. Core Components

The Entity Storage system is comprised of several key services and modules that work together. Here is a high-level overview of each component and its role in the process:

* **Client-side Module (e.g., `Apps.js`)**: The starting point of a request. This is the public-facing API that developers use. It abstracts the internal complexity and calls the backend driver system using a legacy interface name (e.g., `'puter-apps'`).

* **`DriverService.js`**: The central router and translator. It receives requests from client-side modules, translates legacy interface names into their modern equivalents (e.g., `'puter-apps'` -> `'crud-q'`), and routes the call to the appropriate backend service.

* **`EntityStoreInterfaceService.js`**: Defines the "contract" for entity storage. It registers the modern `crud-q` interface and specifies the exact methods (e.g., `create`, `read`, `update`) that any implementing service must provide.

* **`EntityStoreService.js`**: The generic "worker" class that implements the `crud-q` contract. It contains the core logic for handling entity operations, which it delegates to an underlying data provider (the "upstream").

* **`CoreModule.js`**: The "factory" or configuration hub. This module is responsible for creating and registering specific instances of the generic `EntityStoreService` for each entity type (`app`, `subdomain`, `notification`) during application startup.

## 3. End-to-End Workflow Example

To understand how the components work together, let's trace the journey of a single API call, such as creating a new app.

1. The Client Call (`Apps.js`)

The process begins in a client-side module like `Apps.js`. A developer calls a user-friendly function, for example, `puter.apps.create({...})`. Internally, this function makes a call to the backend driver system using a legacy interface name.

```javascript
// Inside Apps.js
return await utils.make_driver_method([...], 'puter-apps', undefined, 'create').call(this, options);

2. The Translation (DriverService.js)

The DriverService receives the request with the interface name 'puter-apps'. Inside its _call method, it uses a lookup table (iface_to_iface) to translate this legacy name into the modern, generic interface name: 'crud-q'. This allows the backend to use a single, standardized interface for all entity types.

JavaScript

// Inside DriverService.js
const iface_to_iface = {
    'puter-apps': 'crud-q',
    'puter-subdomains': 'crud-q',
    'puter-notifications': 'crud-q',
}
iface = iface_to_iface[iface] ?? iface; // 'iface' is now 'crud-q'

3. The Contract (EntityStoreInterfaceService.js)

The system now knows it needs a service that can handle the 'crud-q' interface. It refers to the definition registered in EntityStoreInterfaceService.js to understand the "contract"—the specific methods this interface requires, such as create, read, update, delete, and select.

// Inside EntityStoreInterfaceService.js
col_interfaces.set('crud-q', {
            methods: { ...crudMethods }
});

4. The Implementation (EntityStoreService.js)

The DriverService finds the generic EntityStoreService class because it is the one that officially implements the 'crud-q' contract. This is declared via the static IMPLEMENTS property within the class.

// Inside EntityStoreService.js
class EntityStoreService extends BaseService {
    // ...
    
    static IMPLEMENTS = {
        ['crud-q']: {
            async create ({ object, options }) {
                // ...
                return await this.create(entity, options);
            },
            async update ({ object, id, options }) {
                // ...
            },
            // ... and so on for read, select, delete
        }
    };

    // ...
}

5. The Instantiation (CoreModule.js)

Finally, the system needs to know which specific instance of EntityStoreService to use. CoreModule.js handles this. During application startup, it creates and registers a unique EntityStoreService instance for each entity. For our example, it uses the one registered with the name 'es:app', which was configured specifically to manage the 'app' entity. The request is then passed to the create method of this instance to be executed.

// Inside CoreModule.js

1. For Apps:
services.registerService('es:app', EntityStoreService, {
        entity: 'app',
        upstream: ESBuilder.create([ ... ]),
});

2. For Subdomains:
services.registerService('es:subdomain', EntityStoreService, {
        entity: 'subdomain',
        upstream: ESBuilder.create([ ... ]),
});

3. For Notifications:
services.registerService('es:notification', EntityStoreService, {
        entity: 'notification',
        upstream: ESBuilder.create([ ... ]),
})