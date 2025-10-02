# Type **Node Identifier**

A Node Identifier is a string that specifies a file or
directory on the filesystem. It is either a UUID or an
absolute path.

If the Node Identifier starts with a forward slash (`/`)
it is assumed to be an absolute path. Otherwise, it is
assumed to be the UUID of an existing filesystem node.
