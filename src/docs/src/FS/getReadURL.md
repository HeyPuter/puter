Generates a URL that can be used to read a file.

## Syntax
```javascript
puter.fs.getReadURL(path);
puter.fs.getReadURL(path, expiresIn);
```

## Parameters

#### `path` (String) (Required)

The path to the file to read.

#### `expiresIn` (Number) (Optional)

The number of seconds until the URL expires. If not provided, the URL will expire in 24 hours.

## Returns

A promise that resolves to a URL that can be used to read the file.

## Example

```javascript
const url = await puter.fs.getReadURL("~/myfile.txt");
```