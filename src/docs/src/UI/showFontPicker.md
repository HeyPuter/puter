---
title: puter.ui.showFontPicker()
description: Presents a list of fonts for previewing and selecting.
platforms: [ websites, apps]
---

Presents the user with a list of fonts allowing them to preview and select a font.

## Syntax
```js
puter.ui.showFontPicker()
puter.ui.showFontPicker(defaultFont)
puter.ui.showFontPicker(options)
```

## Parameters
#### `defaultFont` (String) (optional)
The name of the font to select when the font picker is opened, such as `'Georgia'`.

#### `options` (optional)
A set of key/value pairs that configure the font picker.

* `defaultFont` (String): The name of the font to select when the font picker is opened.
* `defaultValue` (String): Legacy alias for `defaultFont`, used when `defaultFont` isn't set.
* `default` (String): Legacy alias for `defaultFont`, used when neither `defaultFont` nor `defaultValue` is set.

## Return value
A `Promise` that resolves to an object with a `fontFamily` property, a CSS `font-family` value for the chosen font. If the user closes the picker without choosing a font, the promise resolves to `false` inside Puter and to `null` on other websites.

## Examples

```html;ui-show-font-picker
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <h1>A cool Font Picker demo!</h1>

    <script>
        puter.ui.showFontPicker().then((font)=>{
            if (!font) return;
            document.body.style.fontFamily = font.fontFamily;
        })
    </script>
</body>
</html>
```