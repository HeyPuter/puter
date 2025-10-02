Displays a context menu at the current cursor position. Context menus provide a convenient way to show contextual actions that users can perform.

## Syntax
```js
puter.ui.contextMenu(options)
```

## Parameters

#### `options` (required)
An object that configures the context menu.

* `items` (Array): An array of menu items and separators. Each item can be either:
  - **Menu Item Object**: An object with the following properties:
    - `label` (String): The text to display for the menu item.
    - `action` (Function, optional): The function to execute when the menu item is clicked. Not required for items with submenus.
    - `icon` (String, optional): The icon to display next to the menu item label. Must be a base64-encoded image data URI starting with `data:image`. Strings not starting with `data:image` will be ignored.
    - `icon_active` (String, optional): The icon to display when the menu item is hovered or active. Must be a base64-encoded image data URI starting with `data:image`. Strings not starting with `data:image` will be ignored.
    - `disabled` (Boolean, optional): If set to `true`, the menu item will be disabled and unclickable. Default is `false`.
    - `items` (Array, optional): An array of submenu items. Creates a submenu when specified.
  - **Separator**: A string `'-'` to create a visual separator between menu items.

## Return value 
This method does not return a value. The context menu is displayed immediately and menu item actions are executed when clicked.

## Examples

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    
    <div id="right-click-area" style="width: 200px; height: 200px; border: 1px solid #ccc; padding: 20px;">
        Right-click me to show context menu
    </div>

    <script>
        document.getElementById('right-click-area').addEventListener('contextmenu', (e) => {
            e.preventDefault(); // Prevent default browser context menu
            
            puter.ui.contextMenu({
                items: [
                    {
                        label: 'Edit Item',
                        action: () => {
                            console.log('Edit action triggered');
                            alert('Editing item...');
                        },
                    },
                    {
                        label: 'Copy Item',
                        action: () => {
                            console.log('Copy action triggered');
                            alert('Item copied!');
                        },
                    },
                    '-', // Separator
                    {
                        label: 'Delete Item',
                        action: () => {
                            console.log('Delete action triggered');
                            if (confirm('Are you sure you want to delete this item?')) {
                                alert('Item deleted!');
                            }
                        },
                    },
                ],
            });
        });
    </script>
</body>
</html>
```

### Advanced Example with Icons, Disabled Items, and Submenus

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    
    <div id="advanced-menu" style="padding: 20px; border: 1px solid #ddd; margin: 10px; cursor: pointer;">
        Right-click for advanced context menu with all features
    </div>

    <script>
        document.getElementById('advanced-menu').addEventListener('contextmenu', function(e) {
            e.preventDefault();
            
            // Note: Icons must be base64-encoded data URIs starting with "data:image"
            // The examples below use simple SVG icons encoded as base64
            puter.ui.contextMenu({
                items: [
                    {
                        label: 'New File',
                        action: () => {
                            console.log('Creating new file');
                        },
                    },
                    {
                        label: 'Export',
                        items: [
                            {
                                label: 'Export as PDF',
                                action: () => console.log('Exporting as PDF'),
                            },
                            {
                                label: 'Export as JSON',
                                action: () => console.log('Exporting as JSON'),
                            },
                            {
                                label: 'Export as CSV',
                                action: () => console.log('Exporting as CSV'),
                            },
                        ],
                    },
                    '-',
                    {
                        label: 'Copy',
                        action: () => {
                            console.log('Copying item');
                        },
                    },
                    {
                        label: 'Paste',
                        disabled: true, // This item is disabled
                        action: () => {
                            console.log('This should not execute');
                        },
                    },
                    '-',
                    {
                        label: 'Settings',
                        icon: 'data:image/svg+xml,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22UTF-8%22%3F%3E%3Csvg%20width%3D%2259px%22%20height%3D%2259px%22%20stroke-width%3D%221.9%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20color%3D%22%23000000%22%3E%3Cpath%20d%3D%22M12%2015C13.6569%2015%2015%2013.6569%2015%2012C15%2010.3431%2013.6569%209%2012%209C10.3431%209%209%2010.3431%209%2012C9%2013.6569%2010.3431%2015%2012%2015Z%22%20stroke%3D%22%23000000%22%20stroke-width%3D%221.9%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M19.6224%2010.3954L18.5247%207.7448L20%206L18%204L16.2647%205.48295L13.5578%204.36974L12.9353%202H10.981L10.3491%204.40113L7.70441%205.51596L6%204L4%206L5.45337%207.78885L4.3725%2010.4463L2%2011V13L4.40111%2013.6555L5.51575%2016.2997L4%2018L6%2020L7.79116%2018.5403L10.397%2019.6123L11%2022H13L13.6045%2019.6132L16.2551%2018.5155C16.6969%2018.8313%2018%2020%2018%2020L20%2018L18.5159%2016.2494L19.6139%2013.598L21.9999%2012.9772L22%2011L19.6224%2010.3954Z%22%20stroke%3D%22%23000000%22%20stroke-width%3D%221.9%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E',
                        icon_active: 'data:image/svg+xml,%3C%3Fxml%20version%3D%221.0%22%20encoding%3D%22UTF-8%22%3F%3E%3Csvg%20width%3D%2259px%22%20height%3D%2259px%22%20stroke-width%3D%221.9%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20color%3D%22%23ffffff%22%3E%3Cpath%20d%3D%22M12%2015C13.6569%2015%2015%2013.6569%2015%2012C15%2010.3431%2013.6569%209%2012%209C10.3431%209%209%2010.3431%209%2012C9%2013.6569%2010.3431%2015%2012%2015Z%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%221.9%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3C%2Fpath%3E%3Cpath%20d%3D%22M19.6224%2010.3954L18.5247%207.7448L20%206L18%204L16.2647%205.48295L13.5578%204.36974L12.9353%202H10.981L10.3491%204.40113L7.70441%205.51596L6%204L4%206L5.45337%207.78885L4.3725%2010.4463L2%2011V13L4.40111%2013.6555L5.51575%2016.2997L4%2018L6%2020L7.79116%2018.5403L10.397%2019.6123L11%2022H13L13.6045%2019.6132L16.2551%2018.5155C16.6969%2018.8313%2018%2020%2018%2020L20%2018L18.5159%2016.2494L19.6139%2013.598L21.9999%2012.9772L22%2011L19.6224%2010.3954Z%22%20stroke%3D%22%23ffffff%22%20stroke-width%3D%221.9%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E',
                        items: [
                            {
                                label: 'Preferences',
                                action: () => console.log('Opening preferences'),
                            },
                            {
                                label: 'Theme',
                                items: [
                                    {
                                        label: 'Light',
                                        action: () => console.log('Setting light theme'),
                                    },
                                    {
                                        label: 'Dark',
                                        action: () => console.log('Setting dark theme'),
                                    },
                                ],
                            },
                        ],
                    },
                ],
            });
        });
    </script>
</body>
</html>
```
