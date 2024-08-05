# Comment Prefixes

Comments have prefixes using
[Conventional: Comments](https://conventionalcomments.org/)
as a **loose** guideline, and using this markdown file as a
the actual guideline.

This document will be updated on an _as-needed_ basis.

## The rules

- A comment line always looks like this:
  - A whitespace character
  - Optional prefix matching `/[a-z-]+\([a-z-]a+\):/`
  - A whitespace character
  - The comment
- Formalized prefixes must follow the rules below
- Any other prefix can be used. After some uses it
  might be good to formalize it, but that's not a hard rule.

## Formalized prefixes

- `todo:` is interchangable with the famous `TODO:`, **except:**
  when lowercase (`todo:`) it can include a scope: `todo(security):`.
- `track:` is used to track common patterns.
  - Anything written after `track:` must be registered in
    [track-comments.md](../devmeta/track-comments.md)
- `wet:` is usesd to track anything that doesn't adhere
  to the DRY principle; the following message should describe
  where similar code is
- `compare(<identifier>):` is used to note differences between other
  implementations of a similar idea
- `name:` pedantic commentary on the name of something
