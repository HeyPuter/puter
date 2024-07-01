### Problem

When sending metadata along with arbitrary JSON objects,
a collision of property names may occur. For example, the
driver system can't place a "type" property on an arbitrary
response coming from a driver because that might also be
the name of a property in the response.


#### Example:
```json
{
    "type": "api:thing",
    "version": "v1.0.0",
    "some": "info"
}
```

#### Awful Solution

Reserved words. Drivers need to know their response can't have
keys like `type` or `version`. If we'd like to add more meta
keys in the future we need to verify that no existing drivers
use the new key we'd like to reserve. If we have have such features
as user-submitted drivers this will be impossibe.
A `meta` key as a single reserved word could work, which is one
of the solutions discussed below.

#### Obvious Solution:

The obvious solution is to return an object with a
`head` property and a `body` propery:

```json
{
  "head": {
    "type": "api:thing",
    "version": "v1.0.0"
  },
  "body": {
    "some": "info"
  }
}
```

I don't mind this solution. I've come up with some alternatives though,
because this solution has a couple drawbacks:
- it looks a little verbose
- it's not backwards-compatible with arbitrary JSON-object responses

## Solutions

### Dollar-Sign Convention

- Objects have two classes of keys:
  - "meta" keys begin with "$"
  - other keys must validate against the
    usual identifier rules: `/[A-Za-z_][A-Za-z0-9_]*/`
- The meta key `$` indicates the schema or class of
  the object.
- Example:
  ```json
  {
    "$": "api:thing",
    "$version": "v1.0.0",

    "some": "info"
  }
  ```
- what sucks about it:
  - `$` might be surprising or confusing
  - response is a subset of valid JSON keys
    (those not including `$`)
- what's nice about it:
  - backwards-compatible with arbitrary JSON-object responses
    which don't already use `$`

### Underscore Convention
- Same as above, but `_` instead of `$`
  ```json
  {
    "_": "api:thing",
    "_version": "v1.0.0",

    "some": "info"
  }
  ```
- what sucks about it:
  - `_` might be confusing
  - response is a subset of valid JSON keys
    (those not including `_`)
- what's nice about it:
  - `_` is conventionally used for private property names,
    so this might be a little less surprising
  - backwards-compatible with arbitrary JSON-object responses
    which don't already use `_`

### Nesting Convention, simplified

- Similar to the "obvious solution" except
  metadata fields are lifted up a level.
  It's relatively inconsequential if meta keys
  have reserved words compared to value keys.
  ```json
  {
    "type": "api:thing",
    "version": "v1.0.0",
    "value": {
        "some": "info"
    }
  }
  ```
  
### Modified Dollar/Underscore convention
- Using `_` in this example, but instead of prefixing
  meta properties they all go under one key.
  ```json
  {
    "_": {
        "type": "api:thing",
        "version": "v1.0.0"
    },

    "some": "info"
  }
  ```
- what sucks about it:
  - `_` might be confusing
  - response is a subset of valid JSON keys
    (those not **exactly** `_`)
- what's nice about it:
  - `_` is conventionally used for private property names,
    so this might be a little less surprising
  - backwards-compatible with arbitrary JSON-object responses
    which don't already use `_` as an exact key
  - only one reserved key
