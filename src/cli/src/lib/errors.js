// Uniform error handling. CLIError carries a user-facing message plus an
// optional hint and exit code; anything else is treated as an unexpected
// failure (still non-zero exit, so automation notices).

import chalk from 'chalk';

export class CLIError extends Error {
  constructor(message, { hint, code = 1 } = {}) {
    super(message);
    this.name = 'CLIError';
    this.hint = hint;
    this.exitCode = code;
  }
}

// Puter SDK rejections are often plain objects like { status, message } or
// { error: { message } } rather than Error instances — dig out something
// human-readable before falling back to a stringified object.
export function messageOf(err) {
  if (!err) return String(err);
  if (typeof err === 'string') return err;
  return (
    err.message ||
    err.error?.message ||
    (typeof err.error === 'string' ? err.error : null) ||
    (() => {
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    })()
  );
}

// The Puter SDK holds an open connection that keeps the event loop alive, so
// commands won't exit on their own. Force an exit after flushing both streams
// (writing '' invokes the callback once pending output has drained), so piped
// output is never truncated.
export function flushAndExit(code) {
  let pending = 2;
  const done = () => {
    if (--pending === 0) process.exit(code);
  };
  process.stdout.write('', done);
  process.stderr.write('', done);
}

export function fail(err) {
  const message = messageOf(err);
  console.error(chalk.red('Error:') + ' ' + message);
  if (err instanceof CLIError && err.hint) {
    console.error(chalk.dim(err.hint));
  }
  flushAndExit(err instanceof CLIError ? err.exitCode : 1);
}

// Wrap an async commander action so it always exits cleanly: 0 on success,
// non-zero (via fail) on error.
export function action(fn) {
  return (...args) => {
    Promise.resolve(fn(...args)).then(() => flushAndExit(0), fail);
  };
}
