---
title: puter.ui.showColorPicker()
description: Presents a color picker dialog for selecting a color.
platforms: [ websites, apps]
---

Presents the user with a color picker dialog allowing them to select a color.

## Syntax
```js
puter.ui.showColorPicker()
puter.ui.showColorPicker(defaultColor)
puter.ui.showColorPicker(options)
```

## Parameters
#### `defaultColor` (String)
The color to select when the color picker is opened, as a hex string such as `#3b82f6` or `#38f`.

#### `options` (Object)
An object with the following properties:

| Option | Type | Description |
|--------|------|-------------|
| `defaultColor` | `String` | The color to select when the color picker is opened, as a hex string. The picker has no alpha, so the alpha in an 8-digit hex such as `#3b82f680` is ignored. If the value isn't a valid hex color, the picker opens on `#3b82f6`. The `defaultValue` and `default` options are accepted as aliases. If more than one is given, `defaultValue` is used, then `defaultColor`, then `default`. |

## Return value
A `Promise` that resolves to the selected color as a lowercase 6-digit hex string, such as `#ff0000`. If the user closes the picker without selecting a color, the promise resolves to `null`.

## Examples

### Change the background to the picked color

```html;ui-show-color-picker
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ui.showColorPicker().then((color)=>{
            if (color) {
                document.body.style.backgroundColor = color;
            }
        })
    </script>
</body>
</html>
```