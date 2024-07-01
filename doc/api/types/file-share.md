# `{"$": "file-share"}` - File Share

## Structure
- **path:** file or directory's path or uuid
- **access:** one of: `"read"`, `"write"` (default: `"read"`)

## Examples

Share with read access
```json
{
    "$": "file-share",
    "path": "/some/path"
}
```

Share with write access
```json
{
    "$": "file-share",
    "path": "/some/path",
    "access": "write"
}
```

Using a UUID
```json
{
    "$": "file-share",
    "path": "b912c381-0c0b-466c-95a6-f9a4fc680a7d"
}
```
