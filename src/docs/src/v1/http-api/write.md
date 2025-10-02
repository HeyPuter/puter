# `/write`
Create a new file with contents, or write to an existing
file.
## Endpoint
`POST https://api.puter.com/write`
## Request
- `Content-Type`: `multipart/form-data`
- `Authorization`: `Bearer <access_token>`
## Authentication
- The `Authorization` header must contain a valid access token to authenticate the user
## Parameters
### Parameter `file`
| Attribute | Value |
| --------- | ----- |
| Required  | Yes |
| Type  | Binary Data |
| Description  | The new contents of the file. |

### Parameter `path`
| Attribute | Value |
| --------- | ----- |
| Required  | Yes |
| Type  | [Node Identifier](./types/node.md) |
| Description  | The destination of the file. If `name` is not specified then this can be an existing file or the path of a new file to create. |

### Parameter `name`
| Attribute | Value |
| --------- | ----- |
| Required  | No |
| Type  | File Name |
| Description  | Specifies a name for the new file. If this parameter is sent, then `path` must exist on the filesystem and must be a directory. |

### Parameter `overwrite`
| Attribute | Value |
| --------- | ----- |
| Required  | No |
| Type  | Boolean Flag |
| Description  | If true, an existing file may be overwritten. This cannot be used with `dedupe_flag`. |

### Parameter `dedupe_name`
| Attribute | Value |
| --------- | ----- |
| Required  | No |
| Type  | Boolean Flag |
| Description  | If true, the file will be renamed if there is a conflict. This cannot be used with `overwrite`. |

### Parameter `app_uid`
| Attribute | Value |
| --------- | ----- |
| Required  | No |
| Type  | UUID |
| Description  | An application to associate with a newly created file. |

### Parameter `thumbnail`
| Attribute | Value |
| --------- | ----- |
| Required  | No |
| Type  | Binary Data |
| Description  | A image to use as the thumbnail for the file that was specified. |

## Notes
The following parameters are unstable and may change
without notice:
- The `shortcut_to` parameter is optional and can be used to create a shortcut to another file by specifying its UID.
- The `shortcut_to_path` parameter is optional and can be used to create a shortcut to another file by specifying its path.
- The `operation_id`, `item_upload_id`, `socket_id`, and `original_client_socket_id` parameters are optional and can be used to pass additional identifiers or IDs for real-time updates or other purposes.
- The `create_missing_ancestors` parameter is optional and can be set to `true` to create missing ancestor directories if they do not exist. If not provided, the default value is `false`.
