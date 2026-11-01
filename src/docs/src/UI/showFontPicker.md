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
#### `defaultFont` (String)
The default font to select when the font picker is opened.

#### `options` (Object)
An object with the following properties:

- `defaultFont` (String): The font to select when the font picker is opened. The name is matched without regard to case. `defaultValue` and `default` are accepted as aliases. If more than one is given, `defaultValue` is used, then `defaultFont`, then `default`.

## Return value
A `Promise` that resolves to an object with a `fontFamily` property holding the name of the selected font. If the user closes the picker without selecting a font, the promise resolves to `false` in a Puter app and to `null` on a website.

## Examples

```html;ui-show-font-picker
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <h1>A cool Font Picker demo!</h1>

    <script>
        puter.ui.showFontPicker().then((font)=>{
            if (font) {
                document.body.style.fontFamily = font.fontFamily;
            }
        })
    </script>
</body>
</html>
```