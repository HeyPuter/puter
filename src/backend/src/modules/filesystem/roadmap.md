## Mountpounts hurdles

- [ ] subdomains use integer IDs to to reference files, which
      only works with PuterFS. This means other filesystem
      providers will not be usable for subdomains.

      Possible solutions:
      - GUI logic to disable subdomains feature for other providers
      - Add a new column to associate subdomains with paths
      - Map non-puterfs nodes to (1B + path_id), where path_id is
        a numeric identifier that is associated with the path, and
        the association is stored in the database or system runtime
        directory.

- [ ] permissions are associated with UUIDs, but will need to
      be able to be associated with paths instead for non-puterfs
      mountpoints.

      - Make path-to-uuid re-writer act on puter-fs only.
      - ACL needs to be able to check path-based permissions
        on non-puterfs mountpoints.
