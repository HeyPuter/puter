# Type-Tagged Objects

```js
{
    "$": "some-type",
    "$version": "0.0.0",
    
    "some_property": "some value",
}
```

## What's a Type-Tagged Object?

Type-Tagged objects are a convention understood by Puter's backend
to communicate meta information along with a JSON object.
The key feature of Type-Tagged Objects is the type key: `"$"`.

## Why Type-Tagged Objects?

The primary reason: to have a consistent convention we can use
anywhere.

- Since other services rarely use `$` in their property names,
  we can safely use this without introducing reserved words and
  re-mapping property names.
- Some places we use this convention might not need it, but
  staying consistent means API end-users can
  [do more with less code](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself).

## Specification

- The `"$"` key indicates a type (or class) of object
- Any other key beginning with `$` is a **meta-key**
- Other keys are not allowed to contain `$`
- `"$version"` must follow [semver](https://semver.org/)
- Keys with multiple `"$"` symbols are reserved for future use

## Alternative Representations

Puter's API will always send results in the format described
above, which is called the "Standard Representation"

Any endpoint which accepts a Type-Tagged Object will also
accept these alternative representations:

### Structured Representation

Depending on the architecture of your client, this format
may be more convenient to work with:
```json
{
    "$": "$meta-body",
    "type": "some-type",
    "meta": { "version": "0.0.0" },
    "body": { "some_property": "some value" }
}
```

### Array Representation

In the array representation, meta values go at the end.
```json
["some-type",
    { "some_property": "some value" },
    { "version": "0.0.0" }
]
```

If the second element of the list is not an object, it
will implicitly be placed in a property called value.
The following are equivalent:

```json
["some-type", "hello"]
```

```json
["some-type", { "value": "hello" }]
```