## 2023-05-05

### Iframe Shell Architecture

Separating the terminal emulator from the shell will make it possible to re-use
Puter's terminal emulator for containers, emulators, and tunnels.

Puter's shell will follow modern approaches for handling data; this means:
- Commands will typically operate on streams of objects
  rather than streams of bytes.
- Rich UI capabilities, such as images, will be possible.

To use Puter's shell, this terminal emulator will include an adapter shell.
The adapter shell will delegate to the real Puter shell and provide a sensible
interface for an end-user using an ANSI terminal emulator.

This means the scope of this terminal emulator is to be compatible with
two types of shells:
- Legacy ANSI-compatible shells
- Modern Puter-compatible shells

To avoid duplicate effort, the ANSI adapter for the Puter shell will be
accessed by the terminal emulator through cross-document messaging,
as though it were any other ANSI shell provided by a third-party service.
This will also keep these things loosely coupled so we can separate the
adapter in the future and allow other terminal emulators to take
advantage of it.

## 2023-05-06

### The Context

In creating the state processor I made a variable called
`ctx`, representing contextual information for state functions.

The context has a few properties on it:
- constants
- locals
- vars
- externs

#### constants

Constants are immutable values tied to the context.
They can be overriden when a context is constructed but
cannot be overwritten within an instance of the context.

#### variables

Variabes are mutable context values which the caller providing
the context might be able to access.

#### locals

Locals are the same as varaibles but the state processor
exports them. This might not have been a good idea;
maybe to the user of a context these should appear
to be the same as variables, because the code using a
context doesn't care what the longevity of locals is
vs variables.

Perhaps locals could be a useful concept for values that
only change under a sub-context, but this is already
true about constants since sub-contexts can override
them. After all, I can't think of a compelling reason
not to allow overridding constants when you're creating
a sub-context.

#### externs

Externs are like constants in that they're not mutable to
the code using a context. However, unlike constants they're
not limited to primitive values. They can be objects and
these objects can have side-effects.

### How to make the context better moving forward?

#### Composing contexts

The ability to compose context would be useful. For example
the readline function could have a context that's a composition
of the ANSI context (containing ANSI constantsl maybe also
library functions in the future), an outputter context since
it outputs characters to the terminal, as well as a context
specific to handlers under the readline utility.

#### Additional reflection
This idea of contexts and compositing contexts is actually
something I've been thinking about for a long time. Contexts
are an essential component in FOAM for example. However, this
idea of separating **constants**, **imports**, and
**side-effect varibles** (that is, variables something else
is able to access),
is not something I thought about until I looked at the source
code for ash (an implementation of `sh`), and considered how
I might make that source code more portable by repreasting
it as language-agnostic data.

## 2023-05-07

### Conclusion of Context Thing from Yesterday

I just figured something out after re-reading yesterday's
devlog entry.

While the State Processor needs a separate concept of
variables vs locals, even the state functions don't care
about this distinction. It's only there so certain values
are cleared at each iteration of the state processor.

This means a context can be composed at each iteration
containing both the instance variables and the transient
variables.

### When Contexts are Equivalent to Pure Functions

In pure-functional logic functions do not have side effects.
This means they would never change a value by reference, but
they would return a value.

When a subcontext is created prior to a function call, this
is equivalent to a pure function under certain conditions:
- the values which may be changed must be explicity stated
- the immediate consequences of updating any value are known

## 2023-05-08

### Sending authorization information to the shell

Separating the terminal emulator from the shell currenly
means that the terminal is a Puter app and the shell is
a service being used by a Puter app, rather than natively
being a Puter app.

This may change in the future, but currently it means the
terminal emulator needs to - not because it's the terminal
emulator, but because it's the Puter application - configure
the shell with authorization information.

There are a few different approaches to this:
- pass query string parameters onto the shell via url
- send a non-binary postMessage with configuration
- send an ANSI escape code followed by a binary-encoded
  configuration message
- construct a Form object in javascript and do a POST
  request to the target iframe

The last option seems like it could be a CORS nightmare since
right now I'm testing in a situation where the shell happens
to be under the same domain name as the terminal emulator, but
this may not always be the case.

Passing query string parameters over means authorization
tokens are inside the DOM. While this is already true
about the parent iframe I'd like to avoid this in case we
find security issues with this approach under different
situations. For example the parent iframe is in a situation
where userselect and the default context menu are disabled,
which may be preventing a user from accidentally putting
sensitive html attributes in their clipboard.

That leaves the two options for sending a postMessage:
either binary, or a non-binary message. The binary approach
would require finding handling an OSC escape sequence handler
and creating some conventions for how to communicate with
Puter's API using ANSI escape codes. While this might be useful
in the future, it seems more practical to create a higher-level
message protocol first and then eventually create an adapter
for OSC codes in the future if need is found for one.

So with that, here are window messages between Puter's
ANSI terminal emulator and Puter's ANSI adapter for Puter's
shell:

#### Ready message

Sent by shell when it's loaded.

```
{ $: 'ready' }
```

#### Config message

Sent by terminal emulator after shell is loaded.

```
{
  $: 'config',
  ...variables
}
```

All `variables` are currently keys from the querystring
but this may change as the authorization mechanism and
available shell features mature.

## 2023-05-09

### Parsing CLI arguments

Node has a bulit-in utility, but using this would be
unreliable because it's allowed to depend on system-provided
APIs which won't be available in a browser.

There's
[a polyfill](https://github.com/pkgjs/parseargs/tree/main)
which doesn't appear to depend on any node builtins.
It does not support sub-commands, nor does it generate
helptext, but it's a starting point.

If each command specifies a parser for CLI arguments, and also
provides configuration in a format specific to that parser,
there are a few advantages:
- easy to migrate away from this polyfill later by creating an
  adapter or updating the commands which use it.
- easy to add custom argument processors for commands which
  have an interface that isn't strictly adherent to convention.
- auto-complete and help can be generated with knowledge of how
  CLI arguments are processed by a particular command.

## 2023-05-10

### Kind of tangential, but synonyms are annoying

The left side of a UNIX pipe is the
- source, faucet, producer, upstream

The right side of a UNIX pipe is the
- target, sink, consumer, downstream

I'm going to go with `source` and `target` for any cases like this
because they have the same number of letters, and I like when similar
lines of code are the same length because it's easier to spot errors.

## 2023-05-14

### Retro: Terminal Architecture

#### class: PreparedCommand

A prepared command contains information about a command which will
be invoked within a pipeline, including:
- the command to be invoked
- the arguments for the command (as tokens)
- the context that the command will be run under

A prepared command is created using the static method
`PreparedCommand.createFromTokens`. It does not have a
context until `setContext` is later called.

#### class Pipeline

A pipeline contains PreparedCommand instances which represent the
commands that will be run together in a pipeline.

A pipeline is created using the static method
`Pipeline.createFromTokens`, which accepts a context under which
the pipeline will be constructed. The pipeline's `execute` method
will also be passed a context when the pipeline should begin running,
and this context can be different. (this is also the context that
will be passed to each `PreparedCommand` instance before each
respective `execute` method is called).

#### class Pipe

A pipe is composed of a readable stream and a writable stream.
A respective `reader` and `writer` are exposed as
`out` and `in` respectively.

The readable stream and writable stream are tied together.

#### class Coupler

A coupler aggregates a reader and a writer and begins actively
reading, relaying all items to the writer.

This behaviour allows a coupler to be used as a way of connecting
two pipes together.

At the time of writing this, it's used to tie the pipe that is
created after the last command in a pipeline to the writer of the
pseudo terminal target, instead of giving the last command this
writer directly. This allows the command to close its output pipe
without affecting subsequent functionality of the terminal.

### Behaviour of echo escapes

#### behaviour of `\\` should be verified
Based on experimentation in Bash:
- `\\` is always seen by echo as `\`
  - this means `\\a` and `\a` are the same

#### difference between `\x` and `\0`

In echo, `\0` initiates an octal escape while `\x` initiates
a hexadecimal escape.

However, `\0` without being followed by a valid octal sequence
is considered to be `NULL`, while `\x` will be outputted literally
if not followed with a valid hexadecimal sequence.

If either of these escapes has at least one valid character
for its respective numeric base, it will be processed with that
value. So, for example, `echo -en "\xag" | hexdump -C` shows
bytes `0A 67`, as does the same with `\x0ag` instead of `\xag`.

## 2023-05-15

### Synchronization bug in Coupler

[this issue](https://github.com/HeyPuter/dev-ansi-terminal/issues/1)
was caused by an issue where the `Coupler` between a pipeline and
stdout was still writing after the command was completed.
This happens because the listener loop in the Coupler is async and
might defer writing until after the pipeline has returned.

This was fixed by adding a member to Coupler called `isDone` which
provides a promise that resolves when the Coupler receives the end
of the stream. As a consequence of this it is very important to
ensure that the stream gets closed when commands are finished
executing; right now the `PreparedCommand` class is responsible for
this behaviour, so all commands should be executed via
`PreparedCommand`.

### tail, and echo output chunking

Right now `tail` outputs the last two items sent over the stream,
and doesn't care if these items contain line breaks. For this
implementation to work the same as the "real" tail, it must be
asserted that each item over the stream is a separate line.

Since `ls` is outputting each line on a separate call to
`out.write` it is working correctly with tail, but echo is not.
This could be fixed in `tail` itself, having it check each item
for line breaks while iterating backwards, but I would rather have
metadata on each command specifying how it expects its input
to be chunked so that the shell can accommodate; although this isn't
how it works in "real" bash, it wouldn't affect the behaviour of
shell scripts or input and it's closer to the model of Puter's shell
for JSON-like structured data, which may help with improved
interoperability and better code reuse.

## 2023-05-22

### Catching Up

There hasn't been much to log in the past few days; most updates
to the terminal have been basic command additions.

The next step is adding the redirect operators (`<` and `>`),
which should involve some information written in this dev log.

### Multiple Output Redirect

In Bash, the redirect operator has precedence over pipes. This is
sensible but also results in some situations where a prompt entry
has dormant pieces, for example two output redirects (only one of
them will be used), or an output redirect and a pipe (the pipe will
receive nothing from stdout of the left-hand process).

Here's an example with two output redirects:

```
some-command > a_file.txt > b_file.txt
```

In Puter's ANSI shell we could allow this as a way of splitting
the output. Although, this only really makes sense if stdout will
also be passed through the pipeline instead of consumed by a
redirect, otherwise the behaviour is counterintuitive.

Maybe for this purpose we can have a couple modes of interpretation,
one where the Puter ANSI Shell behaves how Bash would and another
where it behaves in a more convenient way. Shell scripts with no
hashbang would be interpreted the Bash-like way while shell scripts
with a puter-specific hashbang would be interpreted in this more
convenient way.

For now I plan to prioritize the way that seems more logical as it
will help keep the logic of the shell less complicated. I think it's
likely that we'll reach full POSIX compatibility via Bash running in
containers or emulators before the Puter ANSI shell itself reaches
full POSIX compatibility, so for this reason it makes sense to
prioritize making the Puter ANSI shell convenient and powerful over
making it behave like Bash. Additionally, we have a unique situation
where we're not so bound to backwards compatibility as is a
distribution of a personal computer operating system, so we should
take advantage of that where we can.

## 2023-05-23

### Adding more coreutils

- `clear` was very easy; it's just an escape code
- `printenv` was also very easy; most of the effort was already done

### First steps to handling tab-completion

#### Getting desired tab-completion behaviour from input state
Tab-completion needs information about the type of command arguments.
Since commands are modelled, it's possible the model of a command can
provide this information. For example a registered command could
implement `getTabCompleterFor(ARG_SPEC)`.

`ARG_SPEC` would be an identifier for an argument that is understood
by readline. Ex: `{ $: 'positional', pos: 0 }` for the first positional
argument, or `{ $: 'named', name: 'verbose' }` for a named parameter
called `verbose`.

The command model already has a nested model specifying how arguments
are parsed, so this model could describe the behaviour for a
`getArgSpecFromInputState(input, i)`, where `input` is the
current text in readline's buffer and `i` is the cursor position.
This separates the concern of knowing what parameter the user is
typing in from readline, allowing modelled commands to support tab
completion for arbitrary syntaxes.

**revision**

It's better if the command model has just one method which
readline needs to call, ex: `getTabCompleterFromInputState`.
I've left the above explanation as-is however because it's easier
to explain the two halves if its functionality separately.

### Trigger background readdir call on PWD change

When working on the FUSE driver for Puter's filesystem I noticed that
tab completion makes a readdir call upon the user pressing tab which
blocks the tab completion behaviour until the call is finished.
While this works fine on local filesystems, it's very confusing on
remote filesystems where the ping delay will - for a moment - make it
look like tab completion isn't working at all.

Puter's shell can handle this a bit better. Triggering a readdir call
whenever PWD changes will allow tab-completion to have a quicker
response time. However, there's a caveat; the information about what
nodes exist in that directory might be outdated by the time the user
tries to use tab completion.

My first thought was for "tab twice" to invoke a readdir to get the
most recent result, however this conflicts with pressing tab once to
get the completed path and then pressing tab a second time to get
a list of files within that path.

My second thougfht is using ctrl + tab. The terminal will need to
provide some indication to the user that they can do this and what
is happening.

Here are a few thoughts on how to do this with ideal UX:

- after pressing tab:
  - complete the text if possible
  - highlight the completed portion in a **bright** color
    - a dim colour would convey that the completion wasn't input yet
  - display in a **hint bar** the following items:
    - `[Ctrl+Tab]: re-complete with recent data`
    - `[Ctrl+Enter]: more options`

### Implementation of background readdir

The background `readdir` could be invoked in two ways:
- when the current working directory changes
- at a poll interval

These means the **action** of invoking background readdir needs
to be separate from the method by which it is called.

Also, results from a previous `readdir` need to be marked invalid
when the current working directory changes.

There is a possibility that the user might use tab completion before
the first `readdir` is called for a given pwd, which means the method
to get path completions must be async.

if `readdir` is called because of a pwd change, the poll timer should
be reset so that it's not called again too quickly or at the same
time.

#### Concern Mapping

- **PuterANSIShell**
  - does not need to be aware of this feature
- **readline**
  - needs to trap Tab
  - needs to recognize what command is being entered
  - needs to delegate tab completion logic to the command's model
  - does not need to be aware of how tab completion is implemented
- **readdir action**
  - needs WRITE to cached dir lists
- **readdir poll timer**
  - needs READ to cached dir lists to check when they were
    updated
  - needs the path to be polled

#### Order of implementation

- First implementation will **not** have **background readdir**.
  - Interfaces should be appropriate to implement this after.
- When tab completion is working for paths, then readdir caching
  can be implemented.

## 2023-05-25

### Revising the boundary between ANSI view and Puter Shell

Now there are several coreutil commands and a few key shell
features, so it's a good time to take a look at the architecture
and see if the boundary between the ANSI view and Puter Shell
corresponds to the original intention.

| Shell        | I/O   | instructions |
| ------------ | ----- | ------------ |
| ANSI Adapter | TTY   | text         |
| Puter Shell  | JSON  | logical tree |

Note from the above table that the Puter Shell itself should
be "syntax agnostic" - i.e. it needs the ANSI adapter or a
GUI on top of it to be useful at the UI boundary.

#### Pipelines

The ANSI view should be concerned with pipe syntax, while
pipeline execution should be a concern of the syntax-agnostic
shell. However, currently the ANSI view is responsible for
both. This is because there is no intermediate format for
parsed pipeline instructions.

##### to improve
- create intermediate representation of pipelines and redirects

#### Command IO

The ANSI shell does IO in terms of either bytes or strings. When
commands output strings instead of bytes, their output is adapted
to the Uint8Array type to prevent commands further in the pipeline
from misbehaving due to an unexpected input type.

Since pipeline I/O should be handled at the Puter shell, this kind
of adapting will happen at that level also.

#### to improve
- ANSI view should send full pipeline to Puter Shell
- Puter Shell protocol should be improved so that the
  client/view can specify a desired output format
  (i.e. streams vs objects)

### Pipeline IR

The following is an intermediate representation for pipelines
which separates the concern of the ANSI shell syntax from the
logical behaviour that it respresents.

```javascript
{
  $: 'pipeline',
  nodes: [
    {
      $: 'command',
      id: 'ls',
      positionals: [
        '/ed/Documents'
      ]
    },
    {
      $: 'command',
      id: 'tail',
      params: {
        n: 2
      }
    }
  ]
}
```

The `$` property identifies the type of a particular node.
The space of other properties including the `$` symbol is reserved
for meta information about nodes; for example properties like
`$origin` and `$whitespace` could turn this AST into a
CST.

For the same of easier explanation here I'm going to coin the
term "Abstract Logic Tree" (ALT) and use it along with the
conventional terms as follows:

| Abrv | Name                 | Represents           |
| ---- | -------------------- | -------------------- |
| ALT  | Abstract Logic Tree  | What it does         |
| AST  | Abstract Syntax Tree | How it was described |
| CST  | Concrete Syntax Tree | How it was formatted |

The pipeline format described above is an AST for the
input that was understood by the ANSI shell adapter.
It could be converted to an ALT if the Puter Shell is
designed to understand pipelines a little differently.

```javascript
{
  $: 'tail',
  subject: {
    $: 'list',
    subject: {
      $: 'filepath',
      id: '/ed/Documents'
    }
  }
}
```

This is not final, but shows how the AST for pipeline
syntax can be developed in the ANSI shell adapter without
constraining how the Puter Shell itself works.

### Syntaxes

#### Why CST tokenization in a shell would be useful

There are a lot of decisions to make at every single level
of syntax parsing. For example, consider the following:

```
ls | tail -n 2 > "some \"data\".txt"
```

Tokens can be interpreted at different levels of detail.
A standard shell tokenizer would likely eliminate information
about escape characters within quoted strings at this point.
For example, right now the Puter ANSI shell adapter takes
after what a standard shell does and goes for the second
option described here:

```
[
  'ls', '|', 'tail', '-n', '2', '>',
  // now do we do [","some ", "\\\"", ...],
  // or do we do ["some \"data\".txt"] ?
]
```

This is great for processing and executing commands because
this information is no longer relevant at that stage.

However, suppose you wanted to add support for syntax highlighting,
or tell a component responsible for a specific context of tab
completion where the cursor is with respect to the tokenized
information. This is no longer feasible.

For the latter case, the ANSI shell adapter works around this
issue by only parsing the commandline input up to the cursor
location - meaning the last token will always represent the
input up to the cursor location. The input after is truncated
however, leading to the familiar inconvenient situation seen in
many terminals where tab completion does something illogical with
respect the text after your cursor.

i.e. the following, with the cursor position represented by `X`:

```
echo "hello" > some_Xfile.txt
```

will be transformed into the following:

```
echo "hello" > some_file.txtXfile.txt
```

What would be more helpful:
- terminal bell, because `some_file.txt` is already complete
- `some_other_Xfile.txt` if `some_other_file.txt` exists

So syntax highlighting and tab completion are two reasons why
the CST is useful. There may be other uses as well that I
haven't thought of. So this seems like a reasonable idea.

#### Choosing monolithic or composite lexers

Next step, there are also a lot of decisions to make
about processing the text into tokens.

For example, we can take after the very feature that make
shells so versatile - pipelines - and apply this concept
to the lexer.

```
Level 1 lexer produces:
  ls, |, tail, -n, 2, >, ", some , \", data, \", .txt

Level 2 lexer produces:
  ls, |, tail, -n, 2, >, "some \"data\".txt"

```

This creates another decision fork, actually. It raises the
question of how to associate the token "some \"data\".txt"
with the tokens it was composed from at the previous level
or lexing, if this should be done at all, and otherwise if
CST information should be stored with the composite token.

If lexers provide verbose meta information there might be
a concern about efficiency, however lexers could be
configurable in this respect. Furthermore, lexers could be
defined separately from their implementation and JIT-compiled
based on configuration so you actually get an executable bytecode
which doesn't produce metadata (for when it's not needed).

While designing JIT-compilable lexer definitions is incredibly
out of scope for now, the knowledge that it's possible justifies
the decision to have lexers produce verbose metadata.

If the "Level 1 lexer" in the example above stores CST information
in each token, the "Level 2 lexer" can simply let this information
propagate as it stores information about what tokens were composed
to produce a higher-level token. This means concern about
whitespace and formatting is limited to the lowest-level lexer which
makes the rest of the lexer stack much easier to maintain.

#### An interesting philosophical point about lexers and parsers

Consider a stack of lexers that builds up to high-level constructs
like "pipeline", "command", "condition", etc. The line between a
parser and a lexer becomes blurry, as this is in fact a bottom-up
parser composed of layers, each of which behaves like a lexer.

I'm going to call the layers `PStrata` (singular: `PStratum`)
to avoid collision with these concepts.

### The "Implicit Interface Aggregator"

Vanilla javascript doesn't have interfaces, which sometimes seems
to make it difficult to have guarantees about type methods an
object will implement, what values they'll be able to handle, etc.

To solve some of the drawbacks of not having interfaces, I'm going
to use a pattern which Chat GPT just named the
Implicit Interface Aggregator Pattern.

The idea is simple. Instead of having an interface, you have a class
which acts as the user-facing API, and holds the real implementation
by aggregation. While this doesn't fix everything, it leaves the
doors open for multiple options in the future, such as using
typescript or a modelling framework, without locking either of these
doors too early. Since we're potentially developing on a lot of
low-level concepts, perhaps we'll even have our own technology that
we'd like to use to describe and validate the interfaces of the code
we write at some point in the future.

This class can
handle concerns such as adapting different types of inputs and
outputs; things which an implementation doesn't need to be concerned
with. Generally this kind of separation of concerns would be done
using an abstract class, but this is an imperfect separation of
concerns because the implementor needs to be aware of the abstract
class. Granted, this isn't usually a big deal, but what if the
abstract class and implementors are compiled separately? It may be
advantageous that implementors don't need to have all the build
dependencies of the abstract class.

The biggest drawback of this approach is that while the aggregating
class can implement runtime assertions, it doesn't solve the issue
of the lack of build-time assertions, which are able to prevent
type errors from getting to releases entirely. However, it does
leave room to add type definitions for this class and its
implementors (turning it into the facade pattern), or apply model
definitions (or schemas) to the aggregator and the output of a
static analysis to the implmentors (turning it into a model
definition).

#### Where this will be used

The first use of this pattern will be `PStratum`.
PStratum is a facade which aggregates a PStratumImplementor using
the pattern described above.

The following layers will exist for the shell:
- StringPStratum will take a string and provide bytes.
- LowLexPStratum will take bytes and identify all syntax
  tokens and whitespace.
- HiLexPStratum will create composite tokens for values
  such as string literals
- LogicPStratum will take tokens as input and produce
  AST nodes. For example, this is when successive instances
  of the `|` (pipe) operator will be converted into
  a pipeline construct.


### First results from the parser

It appears that the methods I described above are very effective
for implementing a parser with support for concrete syntax trees.

By wrapping implementations of `Parser` and `PStratum` in facades
it was possible to provide additional functionality for all
implementations in one place:
- `fork` and `join` is implemented by PStratum; each implementation
  does not need to be aware of this feature.
- the `look` function (AKA "peek" behaviour) is implemented by
  PStratum as well.
- A PStratum implementation can implement the behaviour to reach
  for previous values, but PStratum has a default implementation.
  The BytesPStratumImpl overrides this to provide Uint8Arrays instead
  of arrays of Number values.
- If parser implementations don't return a value, Parser will
  create the ParseResult that represents an unrecognized input.

It was also possible to add a Parser factory which adds additional
functionality to the sub-parsers that it creates:
- track the tokens each parser gets from the delegate PStratum
  and keep a record of what lower-level tokens were composed to
  produce higher-level tokens
- track how many tokens each parser has read for CST metadata

A layer called `MergeWhitespacePStratumImpl` completes this by
reading the source bytes for each token and using it to compute
a line and column number. After this, the overall parser is
capable of starting the start byte, end byte, line number, and
column number for each token, as well as preserve this information
for each composite token created at higher levels.

The following parser configuration with a hard-coded input was
tested:

```javascript
sp.add(
    new StringPStratumImpl(`
        ls | tail -n 2 > "test \\"file\\".txt"
    `)
);
sp.add(
    new FirstRecognizedPStratumImpl({
        parsers: [
            cstParserFac.create(WhitespaceParserImpl),
            cstParserFac.create(LiteralParserImpl, { value: '|' }, {
                assign: { $: 'pipe' }
            }),
            cstParserFac.create(UnquotedTokenParserImpl),
        ]
    })
);
sp.add(
    new MergeWhitespacePStratumImpl()
)
```

Note that the multiline string literal begins with whitespace.
It is therefore expected that each token will start on line 1,
and `ls` will start on column 8.

The following is the output of the parser:

```javascript
[
  {
    '$': 'symbol',
    text: 'ls',
    '$cst': { start: 9, end: 11, line: 1, col: 8 },
    '$source': Uint8Array(2) [ 108, 115 ]
  },
  {
    '$': 'pipe',
    text: '|',
    '$cst': { start: 12, end: 13, line: 1, col: 11 },
    '$source': Uint8Array(1) [ 124 ]
  },
  {
    '$': 'symbol',
    text: 'tail',
    '$cst': { start: 14, end: 18, line: 1, col: 13 },
    '$source': Uint8Array(4) [ 116, 97, 105, 108 ]
  },
  {
    '$': 'symbol',
    text: '-n',
    '$cst': { start: 19, end: 21, line: 1, col: 18 },
    '$source': Uint8Array(2) [ 45, 110 ]
  },
  {
    '$': 'symbol',
    text: '2',
    '$cst': { start: 22, end: 23, line: 1, col: 21 },
    '$source': Uint8Array(1) [ 50 ]
  }
]
```

No errors were observed in this output, so I can now continue
adding more layers to the parser to get higher-level
representations of redirects, pipelines, and other syntax
constructs that the shell needs to understand.

## 2023-05-28

### Abstracting away communication layers

As of now the ANSI shell layer and terminal emulator are separate
from each other. To recap, the ANSI shell layer and object-oriented
shell layer are also separate from each other, but the ANSI shell
layer current holds more functionality than is ideal; most commands
have been implemented at the ANSI shell layer in order to get more
functionality earlier in development.

Although the ANSI shell layer and object-oriented shell layer are
separate, they are both coupled with the communication layer that's
currently used between them: cross-document messaging. This is ideal
for communication between the terminal emulator and ANSI shell, but
less ideal for that between that ANSI shell and OO shell. The terminal
emulator is a web app and will always be run in a browser environment,
which makes the dependency on cross-document messaging acceptable.
Furthermore it's a small body of code and it can easily be extended
upon to support multiple protocols of communication in the future
rather than just cross-document messaging. The ANSI shell on the other
hand, which currently communications with the OO shell using
cross-document messaging, will not always be run in a browser
environment. It is also completely dependent on the OO shell, so it
would make sense to bundle the OO shell with it in some environments.

The dependency between the ANSI shell and OO shell is not bidirectional.
The OO shell layer is intended to be useful even without the ANSI shell
layer; for example a GUI for constructing and executing pipelines would
be more elegant built upon the OO shell than the ANSI shell, since there
wouldn't be a layer text processing between two layers of
object-oriented logic. When also considering that in Puter any
alternative layer on top of the OO shell is likely to be built to run
in a browser environment, it makes sense to allow the OO shell to be
communicated with via cross-document messaging.

The following ASCII diagram describes the communication relationships
between various components described above:

```
note: "XD" means cross-document messaging

[web terminal]
    |
   (XD)
    |
    |- (stdio) --- [local terminal]
    |
[ANSI Shell]
    |
  (direct calls / XD)
    |
    |-- (XD) --- [web power tool]
    |
 [OO Shell]

```

It should be interpreted as follows:
- OO shell can communicate with a web power tool via
  cross-document messaging
- the OO shell and ANSI shell should communicate via
  either direct calls (when bundled) or cross-document
  messaging (when not bundled together)
- the ANSI shell can be used under a web terminal via
  cross-document messaging, or a local terminal via
  the standard I/O mechanism of the host operating system.

## 2023-05-29

### Interfacing with structured data

Right now all the coreutils commands currently implemented output
byte streams. However, allowing commands to output objects instead
solves some problems with traditional shells:
- text processing everywhere
  - it's needed to get a desired value from structured data
  - commands are often concerned with the formatting of data
    rather than the significance of the data
  - commands like `awk` are archaic and difficult to use,
    but are often necessary
- information which a command had to obtain is often lost
  - a good example of this is how `ls` colourizes different
    inode types but this information goes away when you pipe
    it to a command like `tail`

#### printing structured data

Users used to a POSIX system will have some expectations
about the output of commands. Sometimes the way an item
is formatted depends on some input arguments, but does not
change the significance of the item itself.

A good example of this is the `ls` command. It prints the
names of files. The object equivalent of this would be for
it to output CloudItem objects. Where it gets tricky is
`ls` with no arguments will display just the name, while
`ls -l` will display details about each file such as the
mode, owner, group, size, and date modified.

##### per-command outputters

If the definition for the `ls` command included an output
formatter this could work - if ls' standard output is
attached to the PTT instead of another command it would
format the output according to the flags.

This still isn't ideal though. If `ls` is piped to `tail`
this information would be lost. This differs from the
expected behaviour from posix systems; for example:

```
ls -l | tail -n 2 > last_two_lines.txt
```

this command would output all the details about the last
two files to the text file, rather than just the names.

##### composite output objects with formatter + data

A command outputting objects could also attach a formatter
to each object. This has the advantage that an object can
move through a pipeline and then be formatted at the end,
but it does have a drawback that sometimes the formatter
will be the same for every object, and sending a copy
of the formatter with each object would be redundant.

##### using a formatter registry

A transient registry of object formatters, existing for
the lifespan of the pipeline, could contain each unique
formatter that any command in the pipeline produced for
one or more of it's output objects. Each object that it
outputs now just needs to refer to an existing formatter
which solves the problem of redundant information passing
through the pipeline


##### keeping it simple

This idea of a transient registry for unique implementations
of some interface could be useful in a general sense. So, I
think it makes sense to actually implement formatters using
the more redundant behaviour first (formatter is coupled with
each object), and then later create an abstraction for
obtaining the correct formatter for an object so that this
optimization can be implemented separately from this specific
use of the optimization.

## 2024-02-01

### StrataParse and Tokens with Command Substitution

**note:** this devlog entry was written in pieces as I made
significant changes to the parser, so information near the
beginning is less accurate than information towards the end.

In the "first half" portion of the terminal parser, which
builds a "lexer"* (*not a pure lexer) for parsing, there
currently exists an implementation of parsing for quoted strings.
I have in the past implemented a quoted string parser at least
two different ways - a state machine parser, and with composable
parsers. The string parser in `buildParserFirstHalf` uses the
second approach. This is what it looks like represented as a
lisp-ish pseudo-code:

```javascript
sequence(
  literal('"')
  repeat(
    choice(
      characters_until('\\' or '"')
      sequence(
        literal('\\')
        choice(
          literal('"'),
          ...escape_substitutions))))
  literal('"'))
```

In a BNF grammar, this might be assigned to a symbol name
like "quoted-string". In `strataparse` this is represented
by having a layer which recognizes the components of a string
(like each sequence of characters between escapes, each escape,
and the closing quotation mark), and then a higher-level layer
which composes those to create a single node representing
the string.

I really like this approach because the result is a highly
configurable parser that will let you control how much
information is kept as you advance to higher-level layers
(ex: CST instead of AST for tab-completion checks),
and only parse to a certain level if desired
(ex: only "first half" of the parser is used for
tab-completion checks).

The trouble is the POSIX Shell Command Language allows part of a
token to be a command substitution, which means a stack needs to
be maintianed to track nested states. Implementing this in the
current hand-written parser was very tricky.

Partway through working on this I took a look at existing
shell syntax parsers for javascript. The results weren't very
promising. None of the available parsers could produce a CST,
which is needed for tab completion and will aid in things
like syntax highlighting in the future.

Between the modules `shell-parse` and `bash-parser`, the first
was able to parse this syntax while the second threw an error:
```
echo $TEST"something to $($(echo echo) do)"with-this another-token
```

Another issue with existing parsers, which makes me wary of even
using pegjs (what `shell-parse` uses) directly is that the AST
they produce requires a lot of branching in the interpreter.
For example it's not known when parsing a token whether you'll
get a `literal`, or a `concatenation` with an array of "pieces"
which might contain literals. This is a perfectly valid
representation of the syntax considering what I mentioned above
about command substitution, but if there can be an array of
pieces I would rather always have an array of pieces. I'm much
more concerned with the simplicity and performance of the
interpreter than the amount of memory the AST consumes.

Finally, my "favourite" part: when you run a script in `bash`
it doesn't parse the entire script and then run it; it either
parses just one line or, if the line is a compound command
(a structure like `if; then ...; done`) it parses multiple
lines until it has parsed a valid compound command. This means
any parser that can only parse complete inputs with valid syntax
would need to repeatedly parse (1 line, 2 lines, 3 lines...)
at each line until one of the parses is successful, if we wish
to mimic the behaviour of a real POSIX shell.

In conclusion, I'm keeping the hand-written parser and
solving command substitution by maintaining state via stacks
in both halves of the parser, and we will absolutely need to
do static analysis and refactoring to simplify the parser some
time in the future.

## 2024-02-04

### Platform Support and Deprecation of separate `puter-shell` repo

To prepare for releasing the Puter Shell under an open-source license,
it makes sense to move everything that's currently in `puter-shell` into
this repo. The separation of concerns makes sense, but it belongs in
a place called "platform support" inside this repo rather than in
another repo (that was an oversight on my part earlier on).

This change can be made incrementally as follows:
- Expose an object which implements support for the current platform
  to all the commands in coreutils.
- Incrementally update commands as follows:
  - add the necessary function(s) to `puter` platform support
    - while doing this, use the instance of the Puter SDK owned
      by `dev-ansi-terminal` instead of delegating to the
      wrapper in the `puter-shell` repo via `postMessage`
  - update the command to use the new implementation
- Once all commands are updated, the XDocumentPuterShell class will
  be dormant and can safely be removed.
