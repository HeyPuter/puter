# `{"$": "app-share"}` - File Share

## Structure
- **name:** name of the app
- **uid:** name of the app

## Notes
- One of `name` or `uid` **must** be specified

## Examples

Share app by name
```json
{
    "$": "app-share",
    "name": "some-app-name"
}
```

Share app by uid
```json
{
    "$": "app-share",
    "uid": "app-0a7337f7-0f8a-49ca-b71a-38d39304fe04"
}
```
