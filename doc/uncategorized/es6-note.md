# Notes about ES6 Class Syntax

## Document Meta

> **backend focus:** This documentation is more relevant to
> Puter's backend than frontend, but is placed here because
> it could apply to other areas in the future.

## Expressions as Methods

One important shortcoming in the ES6 class syntax to be aware of
is that it discourages the use of expressions as methods.

For example:

```javascript
class ExampleClass extends SomeBase {
    intuitive_method_definition () {}
    
    constructor () {
        this.less_intuitive = some_expr();
    }
}
```

Even if it is known that the return type of `some_expr` is a function,
it is still unclear whether it's being used as a callback or
as a method without other context in the code, since this is
how we typically assign instance members rather than methods.

We solve this in Puter's backend using a **trait** called
[AssignableMethodsTrait](../../packages/backend/src/traits/AssignableMethodsTrait.js)
which allows a static member called `METHODS` to contain
method definitions.

### Uses for Expressions as Methods

#### Method Composition

Method Composition is the act of composing methods from other
constituents. For example,
[Sequence](../../packages/backend/src/codex/Sequence.js)
allows composing a method from smaller functions, allowing
easier definition of "in-betwewen-each" behaviors and ways
to track which values from the arguments are actually read
during a particular call.
