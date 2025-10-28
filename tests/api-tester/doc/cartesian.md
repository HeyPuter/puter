# Cartesian Tests

A cartesian test is a test the tries every combination of possible
inputs based on some model. It's called this because the set of
possible states is mathematically the cartesian product of the
list of sets of options.

## Coverage Model

A coverage model is what defines all the variables and their
possible value. The coverage model implies the set of all
possible states (cartesian product).

The following is an example of a coverage model for testing
the `/write` API method for Puter's filesystem:

```javascript
module.exports = new CoverageModel({
    path: {
        format: ['path', 'uid'],
    },
    name: ['default', 'specified'],
    conditions: {
        destinationIsFile: []
    },
    overwrite: [],
});
```

The object will first be flattened. `format` inside `path` will
become a single key: `path.format`,
just as `{ a: { x: 1, y: 2 }, b: { z: 3 } }`
becomes `{ "a.x": 1, "a.y": 2, "b.z": 3 }`

Then, each possible state will be generated to use in tests.
For example, this is one arbitrary state:

```json
{
    "path.format": "path",
    "name": "specified",
    "conditions.destinationIsFile": true,
    "overwrite": false
}
```

Wherever an empty list is specified for the list of possible values,
it will be assumed to be `[false, true]`.

## Finding the Culprit

When a cartesian test fails, if you know the _index_ of the test which
failed you can determine what the state was just by looking at the
coverage model.

For example, if tests are failing at indices `1` and `5`
(starting from `0`, of course) for the `/write` example above,
the failures are likely related and occur when the default
filename is used and the destination (`path`) parameter points
to an existing file.

```
destination is file:  0  1  0  1  0  1  0  1
name is the default:  0  0  1  1  0  0  1  1
test results:         P  F  P  P  P  F  P  P
```

### Interesting note about the anme

I didn't know what this type of test was called at first. I simply knew
I wanted to try all the combinations of possible inputs, and I knew what
the algorithm to do this looked like. I then asked Chat GPT the following
question:

> What do you call the act of choosing one item from each set in a list of sets?

which it answered with:

> The act of choosing one item from each set in a list of sets is typically called the Cartesian Product.

Then after a bit of searching, it turns out neither Chat GPT nor I are the
first to use this term to describe the same thing in automated testing for
software.
