# Filesystem API

Filesystem endpoints allow operations on files and directories in the Puter filesystem.

## POST `/mkdir` (auth required)

### Description

Creates a new directory in the filesystem. Currently support 2 formats:

- Full path: `{"path": "/foo/bar", args ...}` — this API is used by apitest (`./tools/api-tester/apitest.js`) and aligns more closely with the POSIX spec (https://linux.die.net/man/3/mkdir)
- Parent + path: `{"parent": "/foo", "path": "bar", args ...}` — this API is used by `puter-js` via `puter.fs.mkdir`

A future work would be use a unified format for all filesystem operations.

### Parameters

- **path** _- required_
  - **accepts:** `string`
  - **description:** The path where the directory should be created
  - **notes:** Cannot be empty, null, or undefined

- **parent** _- optional_
  - **accepts:** `string | UUID`
  - **description:** The parent directory path or UUID
  - **notes:** If not provided, path is treated as full path

- **overwrite** _- optional_
  - **accepts:** `boolean`
  - **default:** `false`
  - **description:** Whether to overwrite existing files/directories

- **dedupe_name** _- optional_
  - **accepts:** `boolean`
  - **default:** `false`
  - **description:** Whether to automatically rename if name exists

- **create_missing_parents** _- optional_
  - **accepts:** `boolean`
  - **default:** `false`
  - **description:** Whether to create parent directories if they don't exist
  - **aliases:** `create_missing_ancestors`

- **shortcut_to** _- optional_
  - **accepts:** `string | UUID`
  - **description:** Creates a shortcut/symlink to the specified target

### Example

```json
{
  "path": "/user/Desktop/new-directory"
}
```

```json
{
  "parent": "/user",
  "path": "Desktop/new-directory"
}
```

### Response

Returns the created directory's metadata including name, path, uid, and any parent directories created.

## Other Filesystem Endpoints

[Additional endpoints would be documented here...] 