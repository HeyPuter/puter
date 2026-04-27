---
title: puter.ui.setMenubar()
description: Creates a menubar in the UI.
platforms: [ websites, apps]
---

Creates a menubar in the UI. The menubar is a horizontal bar at the top of the window that contains menus.

## Syntax

```js
puter.ui.setMenubar(options)
```

## Parameters

#### `options.items` (Array)

An array of menu items. Each item can be a menu or a menu item. Each menu item can have a label, an action, and a submenu. An item can also be the string `-`, which indicates a separator.

#### `options.items.label` (String)

The label of the menu item.

#### `options.items.action` (Function)

A function to execute when the menu item is clicked.

#### `options.items.items` (Array)

An array of submenu items.

#### `options.items.disabled` (Boolean)

Indicates whether the menu item is disabled.

## Examples

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
