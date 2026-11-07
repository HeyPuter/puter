# Puter Web Components

A suite of web components bundled with the Puter SDK (`puter.js`) so UI works in **any** environment — apps running standalone, as PWAs, on their own domain, or inside puter.com.

## How they work

Load `puter.js`, and the components auto-register. You can then either:

1. **Use the imperative API** — `puter.ui.alert(...)`, `puter.ui.contextMenu(...)` etc. The SDK renders the right component automatically.
2. **Use the components directly** in HTML or JS:

```html
<puter-notification title="Hello" text="This works without puter.com"></puter-notification>
```

```js
const alert = document.createElement('puter-alert');
alert.setAttribute('message', 'Hello');
alert.addEventListener('response', e => console.log(e.detail));
document.body.appendChild(alert);
alert.open();
```

All components use **Shadow DOM** so their styles won't leak into your page. Theming is via **CSS custom properties** (see [Theming](#theming) below).

---

## Component Reference

| Tag | Purpose | Maps to SDK method |
|-----|---------|--------------------|
| [`<puter-alert>`](#puter-alert) | Modal alert dialog | `puter.ui.alert()` |
| [`<puter-prompt>`](#puter-prompt) | Modal text input dialog | `puter.ui.prompt()` |
| [`<puter-notification>`](#puter-notification) | Toast notification | `puter.ui.notify()` |
| [`<puter-context-menu>`](#puter-context-menu) | Context menu with submenus | `puter.ui.contextMenu()` |
| [`<puter-menubar>`](#puter-menubar) | Application menubar | `puter.ui.setMenubar()` |
| [`<puter-spinner>`](#puter-spinner) | Loading overlay | `puter.ui.showSpinner()` / `hideSpinner()` |
| [`<puter-color-picker>`](#puter-color-picker) | Color picker dialog | `puter.ui.showColorPicker()` |
| [`<puter-font-picker>`](#puter-font-picker) | Font picker dialog | `puter.ui.showFontPicker()` |
| [`<puter-user-menu>`](#puter-user-menu) | Account button and Puter's app browser, for first-party apps | none |

---

### `<puter-alert>`

Modal alert with customizable buttons and optional type icon. Uses native `<dialog>` element (focus trap, Escape to close, backdrop).

**Attributes**

| Attribute | Type | Description |
|-----------|------|-------------|
| `message` | string | The alert message |
| `type` | `error` \| `warning` \| `info` \| `success` \| `confirm` | Shows a matching icon with colored background |

**Properties**

| Property | Type | Description |
|----------|------|-------------|
| `buttons` | Array | `[{ label, value?, type? }]`. `type` can be `primary`, `danger`, `success`, `warning`, `info`, `default`. Last button is primary by default |
| `options` | Object | Passthrough options object |

**Events**

| Event | Detail | When |
|-------|--------|------|
| `response` | Button value | User clicked a button or dismissed |

**Example**
```js
const el = document.createElement('puter-alert');
el.setAttribute('message', 'Delete this file?');
el.setAttribute('type', 'warning');
el.buttons = [
    { label: 'Cancel', value: false, type: 'default' },
    { label: 'Delete', value: true, type: 'danger' },
];
el.addEventListener('response', e => console.log('User chose:', e.detail));
document.body.appendChild(el);
el.open();
```

---

### `<puter-prompt>`

Modal dialog with a text input. Enter submits, Escape cancels.

**Attributes**

| Attribute | Type | Description |
|-----------|------|-------------|
| `message` | string | The prompt message shown above the input |
| `placeholder` | string | Placeholder for the input |
| `default-value` | string | Prefilled input value |

**Properties**

| Property | Type | Description |
|----------|------|-------------|
| `options` | Object | Passthrough options object |

**Events**

| Event | Detail | When |
|-------|--------|------|
| `response` | string \| false | The entered value, or `false` if cancelled |

**Example**
```js
const el = document.createElement('puter-prompt');
el.setAttribute('message', 'Rename file');
el.setAttribute('default-value', 'untitled.txt');
el.addEventListener('response', e => {
    if (e.detail !== false) console.log('New name:', e.detail);
});
document.body.appendChild(el);
el.open();
```

---

### `<puter-notification>`

Toast notification in the top-right corner with frosted-glass background. Auto-dismisses after `duration` ms. Multiple notifications stack vertically.

**Attributes**

| Attribute | Type | Description |
|-----------|------|-------------|
| `title` | string | Notification title |
| `text` | string | Notification body text (up to 2 lines) |
| `icon` | string | Icon URL (if omitted, a default icon matching `type` is shown) |
| `round-icon` | (boolean) | Presence makes the icon image circular |
| `type` | `info` \| `success` \| `warning` \| `error` | Chooses default icon and accent color |
| `duration` | number | Auto-dismiss delay in ms (default `5000`, `0` = never auto-dismiss) |

**Events**

| Event | Detail | When |
|-------|--------|------|
| `click` | `{}` | User clicked the notification body |
| `close` | `{}` | Notification dismissed (by user or timer) |

**Example**
```js
const n = document.createElement('puter-notification');
n.setAttribute('title', 'Saved');
n.setAttribute('text', 'Your changes have been saved successfully.');
n.setAttribute('type', 'success');
n.setAttribute('duration', '3000');
document.body.appendChild(n);
```

---

### `<puter-context-menu>`

Positioned menu with nested submenus, icons, keyboard shortcuts, and optional danger-styled items. On mobile (≤480px or coarse pointer), automatically switches to a bottom **action sheet** with backdrop.

**Attributes**

| Attribute | Type | Description |
|-----------|------|-------------|
| `x` | number | Left position in pixels (ignored in sheet mode) |
| `y` | number | Top position in pixels (ignored in sheet mode) |
| `data-submenu` | (boolean) | Marks this as a nested submenu (skips sheet mode) |

**Properties**

| Property | Type | Description |
|----------|------|-------------|
| `items` | Array | Menu items (see Item Schema below) |

**Item schema**

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Item text |
| `icon` | string | SVG string (starts with `<`) or image URL |
| `action` | Function | Called when item is selected |
| `items` | Array | Nested submenu items |
| `disabled` | boolean | Greyed out, not selectable |
| `type` | `danger` | Renders item in red |
| `danger` | boolean | Alias for `type: 'danger'` |
| `shortcut` | string | Right-aligned keyboard shortcut hint (e.g., `'⌘C'`) |
| `checked` | boolean | Shows a checkmark column (reserves space when undefined on other items) |
| `separator` | boolean | Renders as a divider (or use string `'-'` as the item) |

**Events**

| Event | Detail | When |
|-------|--------|------|
| `select` | Selected item | User chose a menu item |
| `close` | `{}` | Menu was dismissed |

**Example**
```js
const menu = document.createElement('puter-context-menu');
menu.setAttribute('x', '100');
menu.setAttribute('y', '200');
menu.items = [
    { label: 'Copy', icon: copyIcon, shortcut: '⌘C', action: () => doCopy() },
    { label: 'Paste', icon: pasteIcon, shortcut: '⌘V', action: () => doPaste() },
    '-',
    { label: 'More', items: [
        { label: 'Option A' },
        { label: 'Option B' },
    ]},
    '-',
    { label: 'Delete', icon: trashIcon, type: 'danger', action: () => doDelete() },
];
document.body.appendChild(menu);
```

---

### `<puter-menubar>`

Fixed top-of-page application menubar. Clicking an item opens its dropdown (rendered via `<puter-context-menu>`). Hover switches dropdowns while one is open.

**Properties**

| Property | Type | Description |
|----------|------|-------------|
| `items` | Array | Top-level items (uses same schema as context menu) |

**Events**

| Event | Detail | When |
|-------|--------|------|
| `select` | Selected item | User chose a menu item from any dropdown |

**Example**
```js
const menubar = document.createElement('puter-menubar');
menubar.items = [
    { label: 'File', items: [
        { label: 'New', shortcut: '⌘N', action: () => newDoc() },
        { label: 'Open…', shortcut: '⌘O', action: () => openDoc() },
        '-',
        { label: 'Save', shortcut: '⌘S', action: () => save() },
    ]},
    { label: 'Edit', items: [
        { label: 'Undo', shortcut: '⌘Z', action: () => undo() },
        { label: 'Redo', shortcut: '⇧⌘Z', action: () => redo() },
    ]},
];
document.body.appendChild(menubar);
```

---

### `<puter-spinner>`

Full-page loading overlay with a spinner and optional message.

**Attributes**

| Attribute | Type | Description |
|-----------|------|-------------|
| `text` | string | Optional text shown below the spinner |

**Methods**

| Method | Description |
|--------|-------------|
| `open()` | Show the overlay (called automatically on append) |
| `close()` | Hide and remove |

**Example**
```js
const s = document.createElement('puter-spinner');
s.setAttribute('text', 'Loading…');
document.body.appendChild(s);
setTimeout(() => s.close(), 2000);
```

---

### `<puter-color-picker>`

Modal color picker with 80 preset swatches, a hex input, and a native HTML5 color input for arbitrary colors.

**Attributes**

| Attribute | Type | Description |
|-----------|------|-------------|
| `default-color` | string | Initial hex color (e.g., `#3b82f6`) |

**Events**

| Event | Detail | When |
|-------|--------|------|
| `response` | string \| null | Selected hex color, or `null` if cancelled |

**Example**
```js
const el = document.createElement('puter-color-picker');
el.setAttribute('default-color', '#ff6b35');
el.addEventListener('response', e => {
    if (e.detail) console.log('Picked:', e.detail);
});
document.body.appendChild(el);
el.open();
```

---

### `<puter-font-picker>`

Modal font picker with curated web-safe fonts grouped by category (System, Sans Serif, Serif, Monospace, Cursive). Has search and live preview. Double-click a font to select and close.

**Attributes**

| Attribute | Type | Description |
|-----------|------|-------------|
| `default-font` | string | Initial font name (e.g., `'Georgia'`) |

**Events**

| Event | Detail | When |
|-------|--------|------|
| `response` | `{ fontFamily: string }` \| null | Selected font (full `font-family` stack), or `null` if cancelled |

**Example**
```js
const el = document.createElement('puter-font-picker');
el.setAttribute('default-font', 'Georgia');
el.addEventListener('response', e => {
    if (e.detail) document.body.style.fontFamily = e.detail.fontFamily;
});
document.body.appendChild(el);
el.open();
```

---

### `<puter-user-menu>`

The account button and Puter's app browser for a first-party app on a Puter subdomain (`notes.puter.com`). It is internal and left out of the public docs, because the app browser only works one subdomain under the Puter origin. It follows the page's own puter.js sign-in, never the Puter session's.

- Signed out, it shows **Sign in**, which calls `puter.auth.signIn()`. A temporary account counts as signed out.
- Signed in, it shows the user's profile picture, or the username's initial when there is none. Clicking it opens a menu with the username and **Sign out**, which calls `puter.auth.signOut()`.
- On a page exactly one label under the Puter origin, with the same scheme and port, an **Apps** button opens the app browser (`/embed/apps`) in a panel under the button. It names the signed-in user as `#user=<uuid>`, so the app browser shows the Puter session's apps only to that user (see `doc/embedding-app-browser.md`), and passes a forced `theme` on as `theme=`. Elsewhere the button is hidden, because the server refuses the framing.
- The menu and the Apps panel hang under their button with a caret pointing at it, and close on Escape, a press outside them, or their button. They're in the browser's top layer where it has one, so a host's `transform`, `overflow` or `z-index` can't clip or cover them. On screens up to 600px wide, the Apps panel spans the width below the button.
- Closing the Apps panel keeps the app browser, so reopening it keeps its scroll and search. Any change to the page's sign-in discards it, so it never stays loaded for the previous user.
- It renders nothing outside a top-level page (`puter.env !== 'web'`), such as inside the Puter desktop.

**Attributes**

| Attribute | Default | Description |
|-----------|---------|-------------|
| `apps-label` | `Apps` | Apps button label, panel title and iframe title |
| `sign-in-label` | `Sign in` | Sign-in button text |
| `sign-out-label` | `Sign out` | Sign-out menu item text |
| `close-label` | `Close` | The Apps panel's close button label |
| `account-label` | `Account` | Account button label, read as `Account: <username>` |
| `theme` | follows the OS | `light` or `dark`, for the component and the app browser in it |

Changing an attribute updates the component in place.

**Parts**

`apps-button`, `avatar`, `sign-in`, `menu` and `apps-panel`, for styling from the host page with `puter-user-menu::part(avatar) { ... }`.

**Events**

| Event | Detail | When |
|-------|--------|------|
| `signin` | `{ user }`, the signed-in user or `null` | Sign in finished |
| `signout` | none | The user signed out from the menu |

**Example**
```html
<header>
    <h1>Notes</h1>
    <puter-user-menu sign-in-label="Se connecter" sign-out-label="Se déconnecter"></puter-user-menu>
</header>
<script>
    document.querySelector('puter-user-menu')
        .addEventListener('signout', () => clearNotes());
</script>
```

---

## Styling

All components render inside Shadow DOM and match puter.com's native GUI appearance. Styles are encapsulated and cannot be overridden from outside the component, except through the parts `<puter-user-menu>` exposes.

## Dark mode

By default, components that ship dark-mode styles auto-adapt to the OS setting (`prefers-color-scheme: dark`): `<puter-notification>`, `<puter-context-menu>`, `<puter-menubar>`, `<puter-color-picker>`, `<puter-font-picker>`, `<puter-user-menu>`.

To force a specific theme regardless of the OS preference, set the `theme` attribute on the component:

| Value | Behavior |
|-------|----------|
| `dark` | Always render in dark theme |
| `light` | Always render in light theme |
| _unset_ | Follow the system `prefers-color-scheme` (default) |

```html
<!-- Force dark, even in an OS configured for light mode -->
<puter-menubar theme="dark"></puter-menubar>

<!-- Force light, even when the OS is in dark mode -->
<puter-notification theme="light" title="Hello"></puter-notification>
```

The attribute is live — changing it at runtime re-paints the component immediately. For `<puter-menubar>` and `<puter-context-menu>`, the `theme` is forwarded to any dropdowns and submenus they spawn, so the whole tree stays in sync.

When you use the imperative API instead of the elements directly, pass a `theme` in the options and it is applied as the `theme` attribute on the rendered component:

```js
puter.ui.setMenubar({ theme: 'dark', items: [ /* … */ ] });
puter.ui.contextMenu({ theme: 'dark', items: [ /* … */ ] });
```

This only takes effect when running standalone (`puter.env === 'web'`). Inside the Puter desktop (`puter.env === 'app'`) the spec is handled by the desktop and the `theme` option is ignored.

## Responsive / mobile

All components have mobile breakpoints at `@media (max-width: 480px)`. Notable behaviors:

- **Context menu** switches to a bottom **action sheet** with backdrop on mobile or coarse-pointer devices
- **Dialogs** become full-width (minus 32px margin) with larger touch targets
- **Input fonts** are 16px on mobile to prevent iOS zoom on focus
- **Notifications** stretch edge-to-edge on narrow screens
