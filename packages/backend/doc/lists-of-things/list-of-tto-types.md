# Types for Type-Tagged Objects

## Internal Use

### `{ $: 'share-intent' }`

- Used in the `/share` endpoint
- Permissions get applied to existing users
- For email shares, is trasnformed into a `token:share`
  which is stored in the `share` database table.

- **variants:**
  - `share-intent:file`
  - `share-intent:app`
- **properties:**
  - `permissions` - a list of permissions to grant
  
### `{ $: 'internal:share' }`
- Stored in the `share` database table
- **properties:**
  - `permissions` - a list of permissions to grant

### `{ $: 'token:share }`

- Stored in a JWT called the "share token"
- Contains only the share UUID

- **properties:**
  - `uid` - UUID of a share
