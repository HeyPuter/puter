# Track Comments

Comments beginning with `// track:`. See
[comment_prefixes.md](../contributors/comment_prefixes.md)

## Track Comment Registry

- `track: type check`:
  A condition that's used to check the type of an imput.
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
