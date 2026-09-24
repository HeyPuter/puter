// Shared helper for spawning npm from the repo's tools/ scripts.
//
// On Windows `npm` resolves to the `npm.cmd` batch shim, which Node refuses
// to spawn without a shell (`spawn EINVAL`). Node also warns when args are
// passed alongside `shell: true` (DEP0190), so the command line is joined
// here; args must be plain words that need no quoting.

import { spawn } from 'node:child_process';

/** `[command, args, options]` for `spawn`. */
export const npmSpawnArgs = (
    args,
    options = {},
    platform = process.platform,
) =>
    platform === 'win32'
        ? [['npm.cmd', ...args].join(' '), [], { ...options, shell: true }]
        : ['npm', args, options];

export const spawnNpm = (args, options = {}) =>
    spawn(...npmSpawnArgs(args, options));
