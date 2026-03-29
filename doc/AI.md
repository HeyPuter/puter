# Puter KV Guide
## Introduction to Puter KV
Puter KV is a key-value store that allows you to store and retrieve data in a flexible and efficient way.
## Querying and Filtering with Puter KV
You can query and filter data in Puter KV using designed keys and patterns. For example, you can use the `puter.kv.list` method to retrieve a list of keys that match a certain pattern. The pattern syntax uses a glob-like syntax, where `*` matches any characters.
### Example
```javascript
const puter = require('puter');
const kv = puter.kv;

// Store some data
kv.put('user:1:name', 'John Doe');
kv.put('user:1:email', 'john@example.com');
kv.put('user:2:name', 'Jane Doe');
kv.put('user:2:email', 'jane@example.com');

// Query and filter data
const users = await kv.list('user:*:name');
console.log(users);
// Output: ['user:1:name', 'user:2:name']

const userEmails = await kv.list('user:*:email');
console.log(userEmails);
// Output: ['user:1:email', 'user:2:email']
```
Note: If no matching keys are found, `kv.list` will return an empty array. You should handle this case according to your application's requirements.
### Linked Playground
You can try out the example above in our [playground](https://playground.puter.com/).