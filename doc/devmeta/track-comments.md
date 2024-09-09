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
- `track: opposite condition of sibling`
  A sibling class, function, method, or other construct of
  source code has a boolean expression which always evaluates
  to the opposite of the one below this track comment.
- `track: null check before processing`
  An object could be undefined or null, additional processing
  occurs after a null check, and the unprocessed object is not
  relevant to the rest of the code. If the code for obtaining
  the object and processing it is moved to a function outside,
  then the null check should result in a early return of null;
  this code with the track comment may have additional logic
  for the null/undefined case.
- `track: manual safe object`
  This code manually creates a new "client-safe" version of
  some object that's in scope. This could be either to pass
  onto the browser or to pass to something like the
  notification service.
- `track: common operations on multiple items`
  A patterm which emerges when multiple variables have
  common operations done upon them in sequence.
  It may be applicable to write an iterator in the
  future, or something will come up that require
  these to be handled with a modular approach instead.
- `track: checkpoint`
  A location where some statement about the state of the
  software must hold true.
