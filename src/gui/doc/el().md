# el()

> **note:** this is _new_. You might try to do things that intuitively should work and they won't. You might have to add support for some attribute in `UIElement.el` itself. Just remember; you don't have to. It's still the DOM API, so you can call a method on the element or pass it to `$(...)` to get some real work done.

## The Premise

`el()` is the element creator. It is a utility function built on the idea that the primary reason developers don't use the DOM API is simply because it's too verbose to be convenient. `el()` is to `document.createElement()` as jquery is to your for loops and recursive functions.

Furthermore, it is perhaps possible that sometimes developers flock to complex frameworks such as React; Angular; and many more, even for relatively simple applications, simply because using the DOM API directly "just feels wrong".

## The Hello World

Let's start with a simple example of creating a div with a class and some text. Using the DOM API directly, it would look like this:
```javascript
const my_div = document.createElement('div');
my_div.classList.add('my-class');
my_div.innerText = 'some text';
```

Using `el()`, we can do the same as above like this:
```javascript
const my_div = el('div.my-class', {
  text: 'hello world'
});
```

That's a lot nicer, isn't it?

When calling `el`, you provide a **descriptor** containing your tag name, classes, id; you do this using the same format as a selector. Using the selector format for this wasn't my idea - I stole it from Pug/Jade. In this example we also pass an object with a `text` attribute. `text` assigns `.innerText` on the element, making it XSS-proof.

## The "What about HTML?"

"but wait!", I hear you say, "HTML strings are still cleaner!". Tools like JSX have made it possible to use HTML syntax within javascript code and avoid caveats such as XSS vulnerabilities. That's great, but you're then forced to either bring in the tooling of a larger framework or build your own framework around JSX. It may seem worth it though; in HTML, you would write the examples above like this:
```html
<div class="my-class">some text</div>
```

Putting the previous example with `el()` on a single line, we see that it's a little longer.

```javascript
el('div.myclass', { text: 'hello wolrd' });
```

However, for `div`, the most common element, you don't actually need to specify the tag name.

```javascript
el('.myclass', { text: 'hello world' });
```

Also, the second string is considered the inner-text.

```javascript
el('.myclass', 'hello world');
```

Maybe this specific example gives `el()` an advantage, but there's a good reason that it would: a `div` with some text in it is likely the second-most common element on your page; second only to divs containing other divs.

## Nesting

The `el` function accepts an array argument. Array arguments are expected to be arrays of DOM elements (that's what `el()` itself returns). This means you can call `el` multiple times inside an array to construct arbitrary trees.

```javascript
el([ el(), el() ])
// <div><div></div><div></div></div>
```

Okay, my comment with the hard-to-read div nesting is a little unfair; you'd probably write the HTML with proper indentation and such:

```html
<div>
  <div></div>
  <div></div>
</div>
```

```javascript
el([
  el(),
  el()
])
```

## Passing the Parent

If you pass a DOM element as the first argument, it will be treated as the parent element. This is, `parent_el.appendChild(new_el)` will be called before you get your `new_el`.

```javascript
el(some_parent_el, 'h1', 'Hello!');
```
