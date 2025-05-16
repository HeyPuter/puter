# Permission Documentation

## Concepts

### Permission

A permission is a string composed of colon-delimited components which identifies
a resource or functionality to which access can be controlled.

For example, `fs:e8ac2973-287b-4121-a75d-7e0619eb8e87:read` is a permission which
represents reading the file or directory with UUID `e8ac2973-287b-4121-a75d-7e0619eb8e87`.

### Group

A group has an owner and several member users. An owner decides what users are in the
group and what users are not. Any user can grant permissions to the group.

### Granting & Revoking

Granting is the act of creating a permission association to a user or group from
the current user. A permission association also holds an object called `extra`
which holds additional claims associated with the permission association.
These are arbitrary and can be used in any way by the subsystem or extension that
is checking the permission. `extra` is usually just an empty object.

Revoking is the act of removing a permission association.

### Permission Options

Permission options are an association between a permission and an actor that can not
be revoked by another actor. For example, the user `ed` always has access to files
under `/ed`. The user `system` always has all permissions granted. These can also be
considered "terminals" because they will always be at
the end of a pathway through granted permissions between users.
This are also called "implied" permissions because they are implied by the system.

### Permission Pathways

A permission pathway is the path between users or groups that leads to a permission.

For example, `ed` can grant the permission `a:b` to `fred`, then `fred` can grant
that permission to the group `cool_group`, and then `alice` may be in the group
`cool_group`. Assuming `ed` holds the implied permission `a:b`, a permission path
exists between `alice` and `ed` via `cool_group` and `fred`:

```
alice <--<> cool_group <-- fred <-- ed (a:b)
```

If any link in this chain breaks the permission is effectively revoked from `alice`
unless there is another pathway leading to a valid permission option for `a:b`.

### Reading - AKA Permission Scan Result

A permission reading is a JSON-serializable object which contains all the pathways
a specified actor has to permissions options matching the specified permission strings.

The following is an example reading for the user `ed3` on the permission
`fs:24729b88-a4c5-4990-ad4e-272b87895732:read`. This file is owned by the
user `admin` who shared it with `ed3`.

```
[
  {
    "$": "explode",
    "from": "fs:24729b88-a4c5-4990-ad4e-272b87895732:read",
    "to": [
      "fs:24729b88-a4c5-4990-ad4e-272b87895732:read",
      "fs:24729b88-a4c5-4990-ad4e-272b87895732:write",
      "fs:24729b88-a4c5-4990-ad4e-272b87895732",
      "fs"
    ]
  },
  {
    "$": "path",
    "via": "user",
    "has_terminal": true,
    "permission": "fs:24729b88-a4c5-4990-ad4e-272b87895732:read",
    "data": {},
    "holder_username": "ed3",
    "issuer_username": "admin",
    "reading": [
      {
        "$": "explode",
        "from": "fs:24729b88-a4c5-4990-ad4e-272b87895732:read",
        "to": [
          "fs:24729b88-a4c5-4990-ad4e-272b87895732:read",
          "fs:24729b88-a4c5-4990-ad4e-272b87895732:write",
          "fs:24729b88-a4c5-4990-ad4e-272b87895732",
          "fs"
        ]
      },
      {
        "$": "option",
        "permission": "fs:24729b88-a4c5-4990-ad4e-272b87895732:read",
        "source": "implied",
        "by": "is-owner",
        "data": {}
      },
      {
        "$": "option",
        "permission": "fs:24729b88-a4c5-4990-ad4e-272b87895732:write",
        "source": "implied",
        "by": "is-owner",
        "data": {}
      },
      {
        "$": "option",
        "permission": "fs:24729b88-a4c5-4990-ad4e-272b87895732",
        "source": "implied",
        "by": "is-owner",
        "data": {}
      },
      {
        "$": "time",
        "value": 19
      }
    ]
  },
  {
    "$": "time",
    "value": 20
  }
]
```

Each object in the reading has a property named `$` which is the type for the object.
The most fundamental types for permission readings are `path` and `option`. A path
always contains another reading, which contains more paths or options. An option
specifies the permission string, the name of the rule that granted the permission,
and a data object which may hold additional claims.

Readings begin with an `explode` if there are multiple strings that may grant the
permission.

Readings end with a `time` that repots how long the reading took to help manage
the potential performance impact of complex permission graphs.

## Permission Service

### check(actor, permissions)

Returns true if the current actor has a path to any permission options matching
any of the permission strings specified by `permissions`. This is done by invoking
`scan()` and returning `true` if there are more than 0 permission options.

### scan(actor, permissions)

Returns a "reading". A permission reading is a JSON-serializable structure.
Readings are described above.

## Permission Scan Sequence

The `scan()` method of **PermissionService** invokes the permission scan sequence.
The permission scan sequence is a [Sequence](https://github.com/HeyPuter/puter/blob/0e0bfd6d7c92eed5080518a099c9a66a2f2dc9ec/src/backend/src/codex/Sequence.js)
that is defined in [scan-permission.js](src/backend/src/structured/sequence/scan-permission.js).
It invokes many "permission scanners" which are defined in
[permission-scanners.js](src/backend/src/unstructured/permission-scanners.js)

The Permission Scan Sequence is as follows:
- `grant_if_system` - if system user, push an option to the reading and stop
- `rewrite_permission` - process the permission through any permission string
  rewriters that were registered with PermissionService by other services.
  For example, since path-based file permissions aren't currently supported
  the FilesystemService regsiters a rewriter that converts any `fs:/`
  permission into a corresponding UUID permission.
- `explode_permission` - break the permission into multiple permissions
  than are sufficient to grant the permission being scanned. For example if
  there are multiple components, like `a.b.c`, having either permission `a.b` or
  `a` granted implis having `a.b.c` granted. Other services can also register
  "permission exploders" which handle non-hierarchical cases such as
  `fs:AAAA:write` implying `fs:AAAA:read`.
- `run_scanners` - run the permission scanners.

Each permission scanner has a name, documentation text, and a scan function.
The scan function has access to the scan sequence's context and can push
objects onto the permission reading.

For information on individual scanners, refer to permission-scanners.js.
