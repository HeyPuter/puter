// Recursively list regular files in a local directory.
// Returns { full, rel } where `rel` is a POSIX path relative to the root,
// suitable for building remote Puter paths.

import fs from 'node:fs';
import path from 'node:path';

export function walk(root) {
  const files = [];
  (function recurse(dir, base) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        recurse(full, rel);
      } else if (entry.isFile()) {
        files.push({ full, rel });
      }
      // symlinks / sockets / fifos are skipped
    }
  })(root, '');
  return files;
}
