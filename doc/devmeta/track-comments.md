# Track Comments

Comments beginning with `// track:`. See
[comment_prefixes.md](../contributors/comment_prefixes.md)

## Track Comment Registry

- `track: type check`:
  A condition that's used to check the type of an imput.
- `track: adapt`
  A value can by adapted from another type at this line.
- `track: bounds check`:
  A condition that's used to check the bounds of an array
  or other list-like entity.
- `track: ruleset`
  A series of conditions that early-return or `continue`
- `track: object description in comment`
  A comment above the creation of some object which
  could potentially have a `description` property.
  This is especially relevant if the object is stored
  in some kind of registry where multiple objects
  could be listed in the console.
- `track: slice a prefix`
  A common pattern where a prefix string is "sliced off"
  of another string to obtain a significant value, such
  as an indentifier.
- `track: actor type`
  The sub-type of an Actor object is checked.
- `track: scoping iife`
  An immediately-invoked function expression specifically
  used to reduce scope clutter.
- `track: good candidate for sequence`
  Some code involves a series of similar steps,
  or there's a common behavior that should happen
  in between. The Sequence class is good for this so
  it might be a worthy migration.
