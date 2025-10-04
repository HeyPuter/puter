Returns whether the app was launched to open one or more items. Use this in conjunction with `onLaunchedWithItems()` to, for example, determine whether to display an empty state or wait for items to be provided.

## Syntax
```js
puter.ui.wasLaunchedWithItems()
```

## Return value
Returns `true` if the app was launched to open items (via double-clicking, 'Open With...' menu, etc.), `false` otherwise.
