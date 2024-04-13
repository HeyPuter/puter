# Puter Terminal Parser

## The `strataparse` package

The `strataparse` package makes it possible to build parser in distinct
layers that we call "strata" (each one called a "stratum"). Rather then
distinguish between a "lexer" and "parser", we can instead have an
arbitrary number of layers that use different approaches to processing
or parsing.

Each stratum implements the method `next (api)`. The `api` object is
provided by strataparse as the bridge between which the strata
interact. Typically, it's used to call `api.delegate` to get a reference
to the lower-level parser. Terminal strata like `StringPStratumImpl`, don't
do this. The `next` method returns the next value in an object of the
form `{ done: true/false, value: ... }`, matching the typical interface
for iterators within this source code. When `done` is true, `value`
can be a message (such as an error) indicating why parsing halted.

## PuterShellParser

At the time of writing this, the PuterShellParser class builds a parser
with 4 strata, listed here from bottom up:

### buildParserFirstHalf (the "lexer half")

[source code](../src/ansi-shell/parsing/buildParserFirstHalf.js)

- A "FirstRecognized" strata which behaves like a lexer. It converts
  characters like `|` to AST nodes like `{ $: 'op.pipe' }`.
  AST nodes use the key `$` to identify the type and can have other
  arbitrary values.
- A "MergeWhitespace" strata which is provided by `strataparse`.
  It converts whitespace to a `{ $: 'whitespace' }` AST node, and
  adds a property called `$cst` to all nodes from the delegate
  (the "lexer") as well as these whitespace nodes. This effectively
  transforms the AST nodes from before into CST nodes, providing
  information about whitespace, line numbers, and column numbers
  in a way subsequent layers can digest.
  (note that these will still be referred to as "AST nodes throughout
  this documentation).

[source code](../src/ansi-shell/parsing/buildParserSecondHalf.js)

### buildParserSecondHalf (the "parser half")
- "ReducePrimitives" creates higher-level AST nodes from some of the
  AST nodes provided by the "previous"(lower/"lexer half") step.
  At the time of writing it's specifically just to deal with strings,
  reducing multiple `{ $: 'string.segment' }` and `{ $: 'string.escape }`
  nodes into a `{ $: 'string' }` node.
- "ShellConstructs" creates higher-level nodes to model the behaviour
  of the shell. For example, a sequence of tokens including
  `{ $: 'op.pipe' }` nodes will be composed into a new `{ $: 'pipeline' }`
  node. The pipeline node contains an array called `components` which
  contains the tokens in between pipe operators.
