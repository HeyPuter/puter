---
title: puter.ui.setMenubar()
description: Creates a menubar in the UI.
platforms: [ websites, apps]
---

Creates a menubar in the UI.

The menubar is a horizontal bar at the top of the window that contains menus.

## Syntax

```js
puter.ui.setMenubar(options)
```

## Parameters

#### `options` (Object)

| Option | Type | Description |
|--------|------|-------------|
| `items` | `Array` | An array of menu items. Each item can be a menu or a menu item. Each menu item can have a label, an action, and a submenu. An item can also be the string `'-'`, which indicates a separator (renders as a horizontal divider between groups of items). The properties of each item are listed below the table. |
| `theme` | `String` | Forces the menubar's color theme, either `'dark'` or `'light'`. When unset, the menubar follows the system color-scheme preference. Only applies when running standalone (`puter.env === 'web'`). Inside the Puter desktop, the menubar is rendered by the desktop, which uses its own theme. |

Each menu item in `items` can have these properties:

- `label` (String): The label of the menu item.
- `action` (Function): A function to execute when the menu item is clicked.
- `items` (Array): An array of submenu items.
- `disabled` (Boolean): Indicates whether the menu item is disabled. Disabled items are visible but cannot be clicked.
- `checked` (Boolean): If `true`, renders a checkmark next to the menu item. Use for toggleable options.
- `icon` (String): URL or data URI of an icon shown next to the menu item label.
- `icon_active` (String): URL or data URI of an icon shown when the menu item is hovered or active. Falls back to `icon` if not provided.

## Examples

### Add a menubar with a File menu

```html;ui-set-menubar
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ui.setMenubar({
            items: [
                {
                    label: 'File',
                    items: [
                        {
                            label: 'Action',
                            action: () => {
                                alert('Action was clicked!');
                            }
                        },
                        {
                            label: 'Sub-Menu',
                            items: [
                                {
                                    label: 'Action 1',
                                    action: () => {
                                        alert('Action 1 was clicked!');
                                    }
                                },
                                {
                                    label: 'Action 2',
                                    action: () => {
                                        alert('Action 2 was clicked!');
                                    }
                                },
                            ]
                        },
                    ]
                },
            ]
        });
    </script>
</body>
</html>
```
