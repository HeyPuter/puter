---
title: puter.fs.getReadURL()
description: Generate a temporary URL to read a file in Puter file system.
platforms: [websites, apps, nodejs, workers]
---

Generates a URL that can be used to read a file.

## Syntax

```js
puter.fs.getReadURL(path)
puter.fs.getReadURL(path, expiresIn)
```

## Parameters

#### `path` (String) (Required)

The path to the file to read.

#### `expiresIn` (String | Number) (Optional)

How long the URL stays valid, in [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken#usage) duration format: a string like `'24h'`, `'30d'`, or `'1h'` (units: `s`, `m`, `h`, `d`, `w`, `y`), or a number of seconds. If not provided, defaults to `'24h'`.

## Return value

A promise that resolves to a URL string that can be used to read the file.

## Example

```javascript
const url = await puter.fs.getReadURL("~/myfile.txt");
```
