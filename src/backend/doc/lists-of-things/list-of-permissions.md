# Permissions

## Filesystem Permissions

### `fs:<PATH-OR-UUID>:<ACCESS-LEVEL>`

- `<PATH-OR-UUID>` specifies the file that this permission
  is associated with.
  The ACL service
  (which checks filesystem permissions)
  knows if the value is a path or UUID based on the presence
  of a leading slash; if it starts with `"/"` it's a path.
- `<ACCESS-LEVEL>` specifies one of:
  `write`, `read`, `list`, `see`; where each item in that
  list implies all the access levels which follow.
- A permission that grants access to a directory,
  such as `/user/shared`, implies access
  of the same **access level** to all child file or directory
  nodes under that location, **recursively**;
  `fs:/user/shared:read` implies `fs:/user/shared/nested/file.txt:read`
- The "real" permission is `fs:<UUID>:<ACCESS-LEVEL>`;
  whenever path is specified the permission is rewritten.
  **note:** future support for other filesystems
  could make this rewrite rule conditional.

## App and Subdomain permissions

### `site:<NAME-OF-SITE>:access`
- `<NAME-OF-SITE>` specifies the subdomain that this
  permission is associated with.
  Here, "subdomain" means the **"name of the subdomain"**,
  which means a site accessed via `my-name.example.site`
  will be specified here with `my-name`.
- This permission is always rewritten as the permission
  described below (backend does this automatically).
  
- `<ACCESS-LEVEL>` may be `access`, `read`, or `write` (where `write` implies `read`, and `read` implies `access`).

### `site:uid#<UUID-OF-SITE>:access`
- If the subdomain is **not** [protected](../features/protected-apps.md),
  this permission is ignored by the system.
- If the subdomain **is** protected, this permission will
  allow access to the site via a Puter app iframe with
  a token for the entity to which permission was granted

### `site:owner#<UUID-OF-USER>:<ACCESS-LEVEL>`
- Grants access to **all protected sites owned by the specified user**.
- When checking a specific site permission (`site:uid#...:<ACCESS-LEVEL>`), the system
  treats this owner-wide permission as sufficient if the site's owner matches.
- You can also specify the owner by username using
  `site:owner@<USERNAME>:<ACCESS-LEVEL>`; it will be rewritten to the canonical
  `owner#<UUID>` form automatically.
  
### `app:<NAME-OF-APP>:<ACCESS-LEVEL>`

- `<NAME-OF-APP>` specifies the app that this
  permission is associated with.
- This permission is always rewritten as the permission
  described below (backend does this automatically).
  
- `<ACCESS-LEVEL>` may be `access`, `read`, or `write` (where `write` implies `read`, and `read` implies `access`).
  
### `app:uid#<UUID-OF-APP>:<ACCESS-LEVEL>`
- If the app is **not** [protected](../features/protected-apps.md),
  this permission is ignored by the system.
- If the app **is** protected, this permission will
  allow reading the app's metadata and seeing that the app exists.

### `app:owner#<UUID-OF-USER>:<ACCESS-LEVEL>`
- Grants access to **all protected apps owned by the specified user**.
- When checking a specific app permission (`app:uid#...:<ACCESS-LEVEL>`), the system
  treats this owner-wide permission as sufficient if the app's owner matches.
- You can also specify the owner by username using
  `app:owner@<USERNAME>:<ACCESS-LEVEL>`; it will be rewritten to the canonical
  `owner#<UUID>` form automatically.
- Same access levels apply: `access`, `read`, `write` (`write` ⇒ `read` ⇒ `access`).
