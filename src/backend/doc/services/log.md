# Logging in Services

Services all have a logger available at `this.log`.

```javascript
class MyService extends BaseService {
    async init () {
        this.log.info('Hello, Logger!');
    }
}
```

There are multiple "log levels", similar to `logrus` or other common logging
libraries.

```javascript
class MyService extends BaseService {
    async init () {
        this.log.info('I\'m just a regular log.');
        this.log.debug('I\'m only for developers.');
        this.log.warn('It is statistically unlikely I will be awknowledged.');
        this.log.error('Something is broken! Pay attention!');
        this.log.noticeme('This will be noticed, unlike warnings. Use sparingly.');
        this.log.system('I am a system event, like shutdown.');
        this.log.tick('A periodic behavior like cache pruning is occurring.');
    }
}
```

Log methods can take a second parameter, an object specifying fields.

```javascript

class MyService extends BaseService {
    async init () {
        this.log.info('I have fields!', {
            why: "why not",
            random_number: 1, // chosen by coin toss, guarenteed to be random
        });
    }
}
```
