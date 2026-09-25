import { describe, expect, it } from 'vitest';

import {
  appRoot,
  assertMovable,
  copyDirection,
  HOME_ROOT,
  isRoot,
  kindOf,
  remoteBasename,
  remoteDirname,
  remoteJoin,
  resolveRemote,
  toOperand,
} from './remotePath.js';

describe('kindOf', () => {
  it('reads the side of the wire off the operand', () => {
    expect(kindOf('puter:/Desktop')).toBe('remote');
    expect(kindOf('-')).toBe('stdio');
    expect(kindOf('./dist')).toBe('local');
    expect(kindOf('dist')).toBe('local');
    // A local file that happens to be named like the prefix is still local.
    expect(kindOf('/tmp/puter')).toBe('local');
  });
});

describe('resolveRemote', () => {
  it('resolves against the home directory, not the system root', () => {
    expect(resolveRemote('puter:/Desktop/notes.txt')).toBe('~/Desktop/notes.txt');
    expect(resolveRemote('puter:/')).toBe(HOME_ROOT);
  });

  it('collapses empty and current-directory components', () => {
    expect(resolveRemote('puter://a//b/./c')).toBe('~/a/b/c');
  });

  it('rebases onto an app store without changing the operand', () => {
    const root = appRoot('app-1f2e');
    expect(resolveRemote('puter:/dist', root)).toBe('~/AppData/app-1f2e/dist');
    expect(resolveRemote('puter:/', root)).toBe('~/AppData/app-1f2e');
  });

  it('refuses to climb out of the root instead of rebasing quietly', () => {
    expect(() => resolveRemote('puter:/../../Documents', appRoot('app-1'))).toThrow(/cannot contain/);
    expect(() => resolveRemote('puter:/dist/../..')).toThrow(/cannot contain/);
  });

  it('refuses relative remote paths, which have nothing to be relative to', () => {
    expect(() => resolveRemote('puter:dist')).toThrow(/must be absolute/);
  });

  it('refuses an operand that is not remote at all', () => {
    expect(() => resolveRemote('./dist')).toThrow(/not a remote path/);
  });
});

describe('isRoot', () => {
  it('recognizes the root of whichever tree is in play', () => {
    expect(isRoot(resolveRemote('puter:/'))).toBe(true);
    expect(isRoot(resolveRemote('puter:/x'))).toBe(false);

    const root = appRoot('app-1');
    expect(isRoot(resolveRemote('puter:/', root), root)).toBe(true);
    expect(isRoot(resolveRemote('puter:/dist', root), root)).toBe(false);
  });
});

describe('toOperand', () => {
  it('round-trips a resolved path back into something a command accepts', () => {
    expect(toOperand('~/logs/a.txt')).toBe('puter:/logs/a.txt');
    expect(toOperand(HOME_ROOT)).toBe('puter:/');

    const root = appRoot('app-1');
    expect(toOperand(`${root}/dist/app.js`, root)).toBe('puter:/dist/app.js');
  });
});

describe('remote path helpers', () => {
  it('stays POSIX regardless of the local platform', () => {
    expect(remoteBasename('~/a/b/c.txt')).toBe('c.txt');
    expect(remoteDirname('~/a/b/c.txt')).toBe('~/a/b');
    expect(remoteDirname('~/a')).toBe(HOME_ROOT);
    expect(remoteJoin('~/a/', 'b', 'c')).toBe('~/a/b/c');
  });
});

describe('copyDirection', () => {
  it('picks the implementation from the operand pair', () => {
    expect(copyDirection('./dist', 'puter:/dist')).toBe('upload');
    expect(copyDirection('puter:/dist', './dist')).toBe('download');
    expect(copyDirection('puter:/a', 'puter:/b')).toBe('remoteCopy');
    expect(copyDirection('-', 'puter:/a')).toBe('writeStdin');
    expect(copyDirection('puter:/a', '-')).toBe('readStdout');
  });

  it('refuses the ambiguous pairs loudly', () => {
    expect(() => copyDirection('./a', './b')).toThrow(/job for cp/);
    expect(() => copyDirection('-', '-')).toThrow(/Cannot copy stdin to stdout/);
    expect(() => copyDirection('-', './a')).toThrow(/Cannot copy/);
    expect(() => copyDirection('./a', '-')).toThrow(/Cannot copy/);
  });
});

describe('assertMovable', () => {
  it('allows remote to remote', () => {
    expect(() => assertMovable('puter:/a', 'puter:/b')).not.toThrow();
  });

  it('refuses to cross the boundary rather than half-implement it', () => {
    expect(() => assertMovable('./a', 'puter:/b')).toThrow(/cannot cross/);
    expect(() => assertMovable('puter:/a', './b')).toThrow(/cannot cross/);
    expect(() => assertMovable('./a', './b')).toThrow(/job for mv/);
    expect(() => assertMovable('-', 'puter:/b')).toThrow(/does not read stdin/);
  });
});
