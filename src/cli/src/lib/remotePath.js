// Operand parsing for `puter fs`.
//
// Which side of the wire a path is on is decided by the operand itself:
// `puter:/...` is remote, `-` is stdin/stdout, anything else is local. Remote
// paths are absolute from the account's home directory — there is no remote
// working directory for a relative path to be relative to — and they are
// clamped to their root, so `..` is refused rather than quietly rebased. With
// `--app` that root is the app's storage directory, and a half-enforced
// sandbox would be worse than none.

import { CLIError } from './errors.js';

const PREFIX = 'puter:';

// The account's home directory. The SDK expands `~` server-side; `/` on Puter
// is the system root (a listing of usernames), which is not what someone
// typing `puter:/` means.
export const HOME_ROOT = '~';

// An app's storage directory, keyed by uid — the same `~/AppData/<uid>` that
// puter.js resolves an app's relative paths against.
export function appRoot(uid) {
  return `${HOME_ROOT}/AppData/${uid}`;
}

export function isRemote(operand) {
  return typeof operand === 'string' && operand.startsWith(PREFIX);
}

export function isStdio(operand) {
  return operand === '-';
}

export function kindOf(operand) {
  if (isStdio(operand)) return 'stdio';
  if (isRemote(operand)) return 'remote';
  return 'local';
}

// The operand form of a resolved remote path, for output that gets piped back
// into another command.
export function toOperand(remotePath, root = HOME_ROOT) {
  if (!remotePath.startsWith(root)) return remotePath;
  const rest = remotePath.slice(root.length);
  return `${PREFIX}${rest.startsWith('/') ? rest : `/${rest}`}`;
}

/**
 * The checks that don't depend on which root a path resolves against, so a
 * malformed operand is refused before we bother authenticating. Returns the
 * path's components.
 *
 * @param {string} operand
 * @returns {string[]}
 */
export function assertRemoteOperand(operand) {
  if (!isRemote(operand)) {
    throw new CLIError(`'${operand}' is not a remote path.`, {
      hint: `Remote paths start with '${PREFIX}/' — e.g. ${PREFIX}/Desktop.`,
    });
  }

  const raw = operand.slice(PREFIX.length);
  if (!raw.startsWith('/')) {
    throw new CLIError(`Remote paths must be absolute: '${operand}'.`, {
      hint: `Write '${PREFIX}/${raw}' — there is no remote working directory for a relative path to resolve against.`,
    });
  }

  const parts = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      throw new CLIError(
        `Remote paths cannot contain '..': '${operand}'.`,
        { hint: `Write the path you mean out in full from ${PREFIX}/.` },
      );
    }
    parts.push(part);
  }

  return parts;
}

/**
 * Resolve a `puter:`-prefixed operand to an absolute remote path under `root`.
 *
 * @param {string} operand
 * @param {string} [root]
 * @returns {string}
 */
export function resolveRemote(operand, root = HOME_ROOT) {
  const parts = assertRemoteOperand(operand);
  return parts.length > 0 ? `${root}/${parts.join('/')}` : root;
}

// Whether a resolved path *is* the root — the guard destructive commands need,
// since no legitimate one-liner empties a whole drive or app store.
export function isRoot(remotePath, root = HOME_ROOT) {
  return remotePath === root;
}

// Remote paths are POSIX regardless of the local platform, so the path
// helpers here are deliberately not node:path (which is `\`-flavoured on
// Windows).
export function remoteBasename(remotePath) {
  const parts = remotePath.split('/');
  return parts[parts.length - 1];
}

export function remoteDirname(remotePath) {
  const parts = remotePath.split('/');
  parts.pop();
  return parts.join('/') || HOME_ROOT;
}

export function remoteJoin(remotePath, ...rest) {
  return [remotePath.replace(/\/+$/, ''), ...rest].join('/');
}

const NEEDS_ONE_REMOTE =
  `One side must be a remote '${PREFIX}/' path.`;

/**
 * Which implementation a `cp` operand pair calls for. Ambiguous pairs are
 * refused loudly rather than guessed at.
 *
 * @param {string} source
 * @param {string} destination
 * @returns {'upload' | 'download' | 'remoteCopy' | 'writeStdin' | 'readStdout'}
 */
export function copyDirection(source, destination) {
  const from = kindOf(source);
  const to = kindOf(destination);

  if (from === 'local' && to === 'remote') return 'upload';
  if (from === 'remote' && to === 'local') return 'download';
  if (from === 'remote' && to === 'remote') return 'remoteCopy';
  if (from === 'stdio' && to === 'remote') return 'writeStdin';
  if (from === 'remote' && to === 'stdio') return 'readStdout';

  if (from === 'local' && to === 'local') {
    throw new CLIError(
      `Both paths are local — copying '${source}' to '${destination}' is a job for cp.`,
      { hint: NEEDS_ONE_REMOTE },
    );
  }
  throw new CLIError(
    `Cannot copy ${from === 'stdio' ? 'stdin' : from} to ${to === 'stdio' ? 'stdout' : to}.`,
    { hint: NEEDS_ONE_REMOTE },
  );
}

/**
 * `mv` is remote-to-remote only in v0: deleting local files after a failed
 * upload is not a first impression worth making.
 *
 * @param {string} source
 * @param {string} destination
 */
export function assertMovable(source, destination) {
  const from = kindOf(source);
  const to = kindOf(destination);
  if (from === 'remote' && to === 'remote') return;

  if (from === 'stdio' || to === 'stdio') {
    throw new CLIError('mv does not read stdin or write stdout.');
  }
  if (from === 'local' && to === 'local') {
    throw new CLIError(
      `Both paths are local — moving '${source}' to '${destination}' is a job for mv.`,
      { hint: NEEDS_ONE_REMOTE },
    );
  }
  throw new CLIError('mv cannot cross between local and remote.', {
    hint: 'Copy it with `puter fs cp`, check the result, then remove the original.',
  });
}
