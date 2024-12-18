# Puter - Common Javascript Module

This is a small module for javascript which you might call a
"language tool"; it adds some behavior to make javascript classes
more flexible, with an aim to avoid any significant complexity.

Each class in this module is best described as an _idea_:

## Libraries

Putility contains general purpose library functions.

### `putility.libs.smol`

A small ("smol") library with commonly useful utility functions. This was
moved here from a utility class called SmolUtil that used to be in Puter's
backend.

#### `ensure_array(value)`

Wraps a value in an array if that value is not an array already.

#### `add(...v)`

Variadic sum function; nothing more.

#### `split(str, sep, options)`

Split a string by the specified separator.

The parameter `options` is optional. It provided, it must be an object
and can have any of the following values:

- `trim` - trim leading and trailing whitespace from each separated component
- `discard_empty` - discard empty components

It is recommended to enable `trim` when `discard_empty` is enabled to also
remove whitespace-only strings.

### `putility.libs.context`

This library exports class **Context**. This provides a context object
that works both in node and the browser.

> **Note:** A lot of Puter's backend code uses a _different_ implementation
> for Context that uses AsyncLocalStorage (only available in node)

When creating a context you pass it an object with values that the context
will hold:

```javascript
const ctx = new Context({
  some_key: 'some value',
});

ctx.some_key; // works just like a regular object
```

You can create sub-contexts using Context**.sub()**:

```javascript
const a = new Context({
  some_key: 'some value'
});
const b = a.sub({
  another_key: 'another value'
});

b.another_key; // "another value"
b.some_key; // "some value"

a.some_key = 'changed';
b.some_key; // "changed"
```

### `putility.libs.time`

This library contains constants for time values in milliseconds.
Available constants are: **DAY**, **HOUR**, **MINUTE**, **SECOND**, **MILLISECOND**.

Please note that while DAY is a constant value of `86400000` milliseconds,
an actual "day" may have 1000 more or 1000 less milliseconds due to the
possibility of a leap second. This library does not account for leap seconds.

### `putility.libs.string`

#### `quote(text)`

Wraps a string in backticks, escaping any present backticks as needed to
disambiguate. Note that this is meant for human-readable text, so the exact
solution to disambiguating backticks is allowed to change in the future.

#### `osclink(url, text)`

Wrap text in OSC escape code to output links in a terminal emulator.

#### `format_as_usd(amount)`

Formats a USD currency amount that may have fractional cents.

### `putility.libs.promise`

Utilities for working with promises.

#### **TeePromise**

Possibily the most useful utility, TeePromise is a Promise that implements
externally-available `resolve()` and `reject()` methods. This is useful
when using async/await syntax as it avoids unnecessary callback handling.

```javascript
const tp = new TeePromise();

new bb = Busboy({ /* ... */ });

// imagine you have lots of code here, that you don't want to
// indent in a `new Promise((resolve, reject) => { ...` block

bb.on('error', err => {
  tp.reject(err);
});
bb.on('close', () => {
  tp.resolve();
})

return {
  // Imagine you have other values here that don't require waiting
  // for the promise to resolve; handling this when a large portion
  // of the code is wrapped in a Promise constructor is error-prone.
  promise: tp,
};
```

## Basees

Putility implements a chain of base classes for general purpose use.
Simply extend the **AdvancedBase** class to add functionality to your
class such as traits and inheritance-merged static objects.

If a class must extend some class outside of putility, then putility is
not meant to support it. This is instead considered "utility code" - i.e.
not part of the application structure that adheres to the design
principles of putility.

### BasicBase

**BasicBase** is the idea that there should be a common way to
see the inheritance chain of the current instance, and obtain
merged objects and arrays from static members of these classes.

### TraitBase

**TraitBase** is the idea that there should be a common way to
"install" behavior into objects of a particular class, as
dictated by the class definition. A trait might install a common
set of methods ("mixins"), decorate all or a specified set of
methods in the class (performance monitors, sanitization, etc),
or anything else.

### AdvancedBase

**AdvancedBase** is the idea that, in a node.js environment,
you always want the ability to add traits to a class and there
are some default traits you want in all classes, which are:

- `PropertiesTrait` - add lazy factories for instance members
  instead of always populating them in the constructor.
- `NodeModuleDITrait` - require node modules in a way that
  allows unit tests to inject mocks easily.
