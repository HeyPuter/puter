Presents a dialog to the user allowing them to share a link on various social media platforms.

## Syntax

```js
puter.ui.socialShare(url)
puter.ui.socialShare(url, message)
puter.ui.socialShare(url, message, options)
```

## Parameters

#### `url` (required)

The URL to share.


#### `message` (optional)

The message to prefill in the social media post. This parameter is only supported by some social media platforms.

#### `options` (optional)

A set of key/value pairs that configure the social share dialog. The following options are supported:

* `left` (Number): The distance from the left edge of the window to the dialog. Default is `0`.
* `top` (Number): The distance from the top edge of the window to the dialog. Default is `0`.