# Parsing Javascript and Generating it Back

## What Purpose?

This would be really useful for refactoring tools. I also want
automatic comments to be placed when certain features are used,
such as the [Sequence](../../src/backend/src/codex/Sequence.js)
class, since its usefulness won't be immediately apparent where
it appears in the source code.

I turns out the state of affairs with respect to generating a
CST for javascript... [kind of sucks](https://github.com/benjamn/recast/issues/1412).
I hope that further discussion on the issue I linked renders the
previous statement ironic.

## So, What Next?

The options I see are:
1. Add support to recast to make use of @babel/parser tokens when
  the `tokens: true` option is set.
2. Add a format-preserving outputter to @babel/outputter.
  [this is being worked on](https://github.com/babel/rfcs/pull/15)
3. Wait for someone else to do either of the previous two things.
4. Write a CST parser for javascript.

I'm going to start with option #3. It's very disappointing that
I don't have time to do #4, because I don't very much like solutions
#1 and #2; I like my CSTs to be more cohesive - a pyramid of meaning -
rather than lexer output dumped at the end of an AST.
