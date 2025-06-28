# Service Configuration

To locate your configuration file, see [Configuring Puter](https://github.com/HeyPuter/puter/wiki/self_hosters-config).

### Accessing Service Configuration

Service configuration appears under the `"services"` property in the
configuration file for Puter. If Puter's configuration had no other
values except for a service config with one key, it might look like
this:

```json
{
    "services": {
        "my-service": {
            "somekey": "some value"
        }
    }
}
```

Services have their configuration object assigned to `this.config`.

```javascript
class MyService extends BaseService {
    async _init () {
        // You can access configuration for a service like this
        this.log.info('value of my key is: ' + this.config.somekey);
    }
}
```

### Accessing Global Configuration

Services can access global configuration. This can be useful for knowing how
Puter itself is configured, but using this global config object for service
configuration is discouraged as it could create conflicts between services.

```javascript
class MyService extends BaseService {
    async _init () {
        // You can access configuration for a service like this
        this.log.info('Puter is hosted on: ' + this.global_config.domain);
    }
}
```
