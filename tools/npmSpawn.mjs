// Shared helper for spawning npm from the repo's tools/ scripts.
//
// On Windows `npm` resolves to the `npm.cmd` batch shim, which Node refuses
// to spawn without a shell on >= 18.20 (CVE-2024-27980 hardening) and throws
// `spawn EINVAL`. Everything else spawns the plain `npm` binary directly.

import { spawn } from 'node:child_process';

export const npmCommand = (platform = process.platform) =>
    platform === 'win32' ? 'npm.cmd' : 'npm';

export const npmSpawnOptions = (options = {}, platform = process.platform) =>
    platform === 'win32' ? { ...options, shell: true } : options;

export const spawnNpm = (args, options = {}) =>
    spawn(npmCommand(), args, npmSpawnOptions(options));
