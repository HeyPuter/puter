// `puter fs` — one-shot file operations against Puter's cloud drive.
//
// Every path is either remote (`puter:/...`), stdin/stdout (`-`), or local,
// and the direction of a transfer is read off the operands rather than a
// flag. See ../lib/remotePath.js for the resolution rules and ../lib/
// transfer.js for how bulk transfers are batched and retried.

import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';

import { resolveTarget } from '../lib/appTarget.js';
import { ensureClient } from '../lib/auth.js';
import { canAnimate, canPrompt } from '../lib/env.js';
import { CLIError, messageOf } from '../lib/errors.js';
import { walk } from '../lib/fswalk.js';
import {
  appRoot,
  assertMovable,
  assertRemoteOperand,
  copyDirection,
  HOME_ROOT,
  isRemote,
  isRoot,
  remoteBasename,
  remoteDirname,
  remoteJoin,
  resolveRemote,
  toOperand,
} from '../lib/remotePath.js';
import {
  DEFAULT_CONCURRENCY,
  pool,
  readRemote,
  uploadFiles,
  withRetry,
  writeChunk,
} from '../lib/transfer.js';
import * as ui from '../lib/ui.js';

// How many failures to name before summarizing the rest.
const MAX_REPORTED_FAILURES = 10;

// --- errors ----------------------------------------------------------------

function wrap(err, message) {
  if (err instanceof CLIError) return err;
  return new CLIError(`${message}: ${messageOf(err)}`);
}

const isMissing = (err) =>
  Number(err?.status) === 404 ||
  err?.code === 'not_found' ||
  err?.code === 'subject_does_not_exist' ||
  /not found|does not exist/i.test(messageOf(err));

// --- context ---------------------------------------------------------------

/**
 * The client plus the remote root every path in this invocation resolves
 * against. `--app` rebases that root onto one app's storage directory; the
 * label goes into the echo that destructive commands print, so the rebasing
 * is visible exactly when it matters.
 */
async function connect(opts) {
  const puter = await ensureClient();
  if (!opts.app) return { puter, opts, root: HOME_ROOT, label: null };

  const { name, uid, byUid, kind } = await resolveTarget(puter, opts.app);
  const label = byUid
    ? uid
    : `${kind === 'worker' ? 'worker ' : ''}${name} (${uid})`;
  return { puter, opts, root: appRoot(uid), label };
}

// With `--app` an absolute path means something other than what it reads as,
// so anything that changes or removes files says what it resolved to.
function echoResolved(ctx, command, resolved) {
  if (!ctx.label) return;
  ui.status(`${command} → ${resolved} ${ui.dim(`[${ctx.label}]`)}`);
}

// --- remote helpers --------------------------------------------------------

async function statOrNull(puter, remotePath) {
  try {
    return await puter.fs.stat(remotePath);
  } catch (err) {
    if (isMissing(err)) return null;
    throw wrap(err, `Could not read '${remotePath}'`);
  }
}

async function statRemote(puter, remotePath, label) {
  const info = await statOrNull(puter, remotePath);
  if (!info) throw new CLIError(`No such file or directory '${label}'.`);
  return info;
}

// readdir returns the full listing as an array, or a `{items}` page when
// pagination params were passed.
async function listAll(puter, arg) {
  const result = await puter.fs.readdir(arg);
  return Array.isArray(result) ? result : (result?.items ?? []);
}

// One page with a total beats pulling a whole tree just to count it; a
// backend that ignores `includeTotal` falls back to the full listing.
async function countEntries(puter, target) {
  const page = await puter.fs.readdir({
    path: target,
    recursive: true,
    includeTotal: true,
    limit: 1,
  });
  if (!Array.isArray(page) && Number.isFinite(page?.total)) return page.total;
  if (Array.isArray(page)) return page.length;
  if (!page?.cursor) return page?.items?.length ?? 0;
  return (await listAll(puter, { path: target, recursive: true })).length;
}

// The paths of a directory's files, relative to it. Used by `-n` — one
// recursive listing beats a stat per file.
async function remoteRelativeFiles(puter, dir) {
  const info = await statOrNull(puter, dir);
  if (!info?.is_dir) return new Set();

  const base = info.path;
  const relatives = new Set();
  for (const entry of await listAll(puter, { path: dir, recursive: true })) {
    if (entry.is_dir) continue;
    const entryPath = typeof entry.path === 'string' ? entry.path : '';
    if (entryPath.startsWith(`${base}/`)) {
      relatives.add(entryPath.slice(base.length + 1));
    }
  }
  return relatives;
}

// mkdir -p on the destination root. upload() creates the directories its
// items sit in, but not the root they sit under.
async function ensureRemoteDir(puter, dir) {
  try {
    await puter.fs.mkdir(dir, { createMissingParents: true, dedupeName: false });
  } catch (err) {
    // Already there is the common case; a real failure surfaces on upload.
    ui.debug('mkdir note:', messageOf(err));
  }
}

// --- local helpers ---------------------------------------------------------

function statLocal(target, label) {
  try {
    return fs.statSync(target);
  } catch {
    throw new CLIError(`No such file or directory '${label}'.`);
  }
}

function isLocalDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

async function readStdinBuffer() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// --- formatting ------------------------------------------------------------

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? value : value < 10 ? value.toFixed(1) : Math.round(value);
  return `${rounded} ${SIZE_UNITS[unit]}`;
}

// fsentry timestamps are unix seconds.
function formatTime(seconds) {
  if (!seconds) return '-';
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function parseConcurrency(value) {
  if (value === undefined) return DEFAULT_CONCURRENCY;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32) {
    throw new CLIError(
      `--concurrency must be a whole number from 1 to 32 (got '${value}').`,
    );
  }
  return parsed;
}

// Partial failure in a bulk transfer doesn't abort the run: the failures are
// named here and the non-zero exit comes from the summary.
function reportFailures(failures, total, verb) {
  if (failures.length === 0) return;
  for (const failure of failures.slice(0, MAX_REPORTED_FAILURES)) {
    ui.warn(`${failure.rel}: ${failure.message}`);
  }
  if (failures.length > MAX_REPORTED_FAILURES) {
    ui.info(`… and ${failures.length - MAX_REPORTED_FAILURES} more.`);
  }
  throw new CLIError(
    `${failures.length} of ${total} file(s) failed to ${verb}.`,
  );
}

// --- ls --------------------------------------------------------------------

function printLongListing(entries) {
  const rows = entries.map((entry) => ({
    type: entry.is_dir ? 'd' : '-',
    size: entry.is_dir ? '-' : formatSize(Number(entry.size)),
    modified: formatTime(entry.modified),
    name: entry.is_dir ? `${entry.name}/` : entry.name,
  }));
  const widest = (key) => rows.reduce((max, row) => Math.max(max, row[key].length), 0);
  const sizeWidth = widest('size');
  const timeWidth = widest('modified');

  for (const row of rows) {
    ui.out(
      `${row.type} ${row.size.padStart(sizeWidth)} ` +
        `${row.modified.padEnd(timeWidth)} ${row.name}`,
    );
  }
}

export async function fsLs(pathArg, opts) {
  assertRemoteOperand(pathArg);
  const ctx = await connect(opts);
  const target = resolveRemote(pathArg, ctx.root);

  try {
    if (opts.json || opts.long) {
      const entries = await listAll(ctx.puter, target);
      if (opts.json) ui.out(JSON.stringify(entries, null, 2));
      else printLongListing(entries);
      return;
    }

    // A terminal gets bare names; a pipe gets operands that feed straight
    // back into another `puter fs` command.
    const human = canAnimate();
    const emit = (entries) => {
      for (const entry of entries) {
        ui.out(
          human
            ? entry.is_dir
              ? `${entry.name}/`
              : entry.name
            : toOperand(remoteJoin(target, entry.name), ctx.root),
        );
      }
    };

    // Streamed page by page, so a large directory starts printing instead of
    // buffering. An SDK without a streaming readdir answers the same call
    // with the whole listing, so use that rather than asking twice.
    const listing = ctx.puter.fs.readdir({ path: target, stream: true });
    if (typeof listing?.[Symbol.asyncIterator] === 'function') {
      for await (const page of listing) emit(page.items ?? []);
      return;
    }
    const result = await listing;
    emit(Array.isArray(result) ? result : (result?.items ?? []));
  } catch (err) {
    throw wrap(err, `Could not list '${pathArg}'`);
  }
}

// --- cat -------------------------------------------------------------------

async function catRemote(ctx, pathArg) {
  const target = resolveRemote(pathArg, ctx.root);
  const info = await statRemote(ctx.puter, target, pathArg);
  if (info.is_dir) {
    throw new CLIError(`'${pathArg}' is a directory.`, {
      hint: `List it with: puter fs ls ${pathArg}`,
    });
  }

  try {
    for await (const chunk of readRemote(ctx.puter, target, Number(info.size))) {
      await writeChunk(process.stdout, chunk);
    }
  } catch (err) {
    throw wrap(err, `Could not read '${pathArg}'`);
  }
}

export async function fsCat(pathArg, opts) {
  assertRemoteOperand(pathArg);
  await catRemote(await connect(opts), pathArg);
}

// --- cp --------------------------------------------------------------------

async function uploadLocal(ctx, sourceArg, destArg, concurrency) {
  const { puter, opts } = ctx;
  const source = path.resolve(sourceArg);
  const localStat = statLocal(source, sourceArg);
  const destination = resolveRemote(destArg, ctx.root);
  const destInfo = await statOrNull(puter, destination);

  // Like cp: into the destination when it's an existing directory, otherwise
  // the destination names the copy itself.
  const intoDir = Boolean(destInfo?.is_dir);

  if (!localStat.isDirectory()) {
    const target = intoDir
      ? remoteJoin(destination, path.basename(source))
      : destination;
    if (opts.noClobber && (intoDir ? await statOrNull(puter, target) : destInfo)) {
      ui.info(`Skipped ${target} (exists).`);
      return;
    }
    if (opts.dryRun) {
      ui.out(`${sourceArg} → ${target}`);
      ui.info('Dry run — nothing was copied.');
      return;
    }
    try {
      await withRetry(() =>
        puter.fs.write(target, fs.readFileSync(source), {
          overwrite: !opts.noClobber,
          dedupeName: false,
          createMissingParents: true,
        }),
      );
    } catch (err) {
      throw wrap(err, `Could not copy '${sourceArg}'`);
    }
    ui.success(`Copied to ${target}.`);
    return;
  }

  if (!opts.recursive) {
    throw new CLIError(`'${sourceArg}' is a directory — pass -r to copy it.`);
  }

  const targetDir = intoDir
    ? remoteJoin(destination, path.basename(source))
    : destination;
  const files = walk(source);
  if (files.length === 0) {
    ui.warn(`'${sourceArg}' contains no files.`);
    return;
  }

  echoResolved(ctx, `cp -r ${sourceArg} ${destArg}`, targetDir);

  let planned = files;
  if (opts.noClobber) {
    const existing = await remoteRelativeFiles(puter, targetDir);
    planned = files.filter((file) => !existing.has(file.rel));
    const skipped = files.length - planned.length;
    if (skipped > 0) ui.info(`Skipping ${skipped} file(s) that already exist.`);
  }

  if (opts.dryRun) {
    for (const file of planned) ui.out(`${file.full} → ${remoteJoin(targetDir, file.rel)}`);
    ui.info(`Dry run — ${planned.length} file(s) would be copied.`);
    return;
  }
  if (planned.length === 0) return;

  await ensureRemoteDir(puter, targetDir);

  const spinner = ui.spinner(`Copying ${planned.length} file(s) to ${targetDir}…`);
  const { uploaded, failures } = await uploadFiles(puter, {
    files: planned,
    destination: targetDir,
    concurrency,
    noClobber: Boolean(opts.noClobber),
    onProgress: (done, total) => spinner.message(`Copied ${done}/${total} file(s)…`),
    onRetry: (err, attempt) => ui.debug(`retry ${attempt}:`, messageOf(err)),
  });
  spinner.stop(`Copied ${uploaded} of ${planned.length} file(s).`);

  reportFailures(failures, planned.length, 'copy');
}

async function downloadFile(puter, remotePath, size, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });

  // Write beside the target and rename, so a failed transfer never leaves a
  // truncated file under the name the caller asked for.
  const partial = `${target}.puter-partial`;
  const handle = fs.openSync(partial, 'w');
  try {
    for await (const chunk of readRemote(puter, remotePath, size)) {
      fs.writeSync(handle, chunk);
    }
  } catch (err) {
    fs.closeSync(handle);
    try {
      fs.unlinkSync(partial);
    } catch {
      // nothing to clean up
    }
    throw err;
  }
  fs.closeSync(handle);
  fs.renameSync(partial, target);
}

async function downloadRemote(ctx, sourceArg, destArg, concurrency) {
  const { puter, opts } = ctx;
  const source = resolveRemote(sourceArg, ctx.root);
  const info = await statRemote(puter, source, sourceArg);
  const destination = path.resolve(destArg);
  const intoDir = isLocalDir(destination);

  if (!info.is_dir) {
    const target = intoDir
      ? path.join(destination, remoteBasename(source))
      : destination;
    if (opts.noClobber && fs.existsSync(target)) {
      ui.info(`Skipped ${target} (exists).`);
      return;
    }
    if (opts.dryRun) {
      ui.out(`${source} → ${target}`);
      ui.info('Dry run — nothing was copied.');
      return;
    }
    try {
      await downloadFile(puter, source, Number(info.size), target);
    } catch (err) {
      throw wrap(err, `Could not copy '${sourceArg}'`);
    }
    ui.success(`Copied to ${target}.`);
    return;
  }

  if (!opts.recursive) {
    throw new CLIError(`'${sourceArg}' is a directory — pass -r to copy it.`);
  }

  const targetDir = intoDir
    ? path.join(destination, remoteBasename(source))
    : destination;
  // Entry paths come back resolved (`/username/...`), so relative paths are
  // taken against the source's own resolved path rather than the `~` form.
  const base = info.path;
  const files = (await listAll(puter, { path: source, recursive: true }))
    .filter((entry) => !entry.is_dir && typeof entry.path === 'string')
    .filter((entry) => entry.path.startsWith(`${base}/`))
    .map((entry) => ({
      remote: entry.path,
      rel: entry.path.slice(base.length + 1),
      size: Number(entry.size),
    }));

  if (files.length === 0) {
    ui.warn(`'${sourceArg}' contains no files.`);
    return;
  }

  let planned = files;
  if (opts.noClobber) {
    planned = files.filter((file) => !fs.existsSync(path.join(targetDir, file.rel)));
    const skipped = files.length - planned.length;
    if (skipped > 0) ui.info(`Skipping ${skipped} file(s) that already exist.`);
  }

  if (opts.dryRun) {
    for (const file of planned) ui.out(`${file.remote} → ${path.join(targetDir, file.rel)}`);
    ui.info(`Dry run — ${planned.length} file(s) would be copied.`);
    return;
  }
  if (planned.length === 0) return;

  const failures = [];
  let done = 0;
  const spinner = ui.spinner(`Copying ${planned.length} file(s) to ${targetDir}…`);
  await pool(planned, concurrency, async (file) => {
    try {
      await downloadFile(puter, file.remote, file.size, path.join(targetDir, file.rel));
    } catch (err) {
      failures.push({ rel: file.rel, message: messageOf(err) });
    }
    spinner.message(`Copied ${++done}/${planned.length} file(s)…`);
  });
  spinner.stop(`Copied ${planned.length - failures.length} of ${planned.length} file(s).`);

  reportFailures(failures, planned.length, 'copy');
}

async function copyWithinDrive(ctx, sourceArg, destArg) {
  const { puter, opts } = ctx;
  const source = resolveRemote(sourceArg, ctx.root);
  const destination = resolveRemote(destArg, ctx.root);
  const info = await statRemote(puter, source, sourceArg);

  if (info.is_dir && !opts.recursive) {
    throw new CLIError(`'${sourceArg}' is a directory — pass -r to copy it.`);
  }

  const destInfo = await statOrNull(puter, destination);
  const intoDir = Boolean(destInfo?.is_dir);
  const finalPath = intoDir
    ? remoteJoin(destination, remoteBasename(source))
    : destination;

  if (opts.noClobber) {
    const existing = intoDir ? await statOrNull(puter, finalPath) : destInfo;
    if (existing) {
      ui.info(`Skipped ${finalPath} (exists).`);
      return;
    }
  }

  echoResolved(ctx, `cp ${sourceArg} ${destArg}`, finalPath);
  if (opts.dryRun) {
    ui.out(`${source} → ${finalPath}`);
    ui.info('Dry run — nothing was copied.');
    return;
  }

  // copy() copies *into* an existing directory; anything else names the copy
  // itself, which means splitting the new name off the destination.
  try {
    await withRetry(() =>
      puter.fs.copy(source, intoDir ? destination : remoteDirname(destination), {
        overwrite: true,
        dedupeName: false,
        ...(intoDir ? {} : { newName: remoteBasename(destination) }),
      }),
    );
  } catch (err) {
    throw wrap(err, `Could not copy '${sourceArg}'`);
  }
  ui.success(`Copied to ${finalPath}.`);
}

async function writeStdinTo(ctx, destArg) {
  const { puter, opts } = ctx;
  const destination = resolveRemote(destArg, ctx.root);
  const destInfo = await statOrNull(puter, destination);
  if (destInfo?.is_dir) {
    throw new CLIError(`'${destArg}' is a directory — name the file to write.`);
  }
  if (opts.noClobber && destInfo) {
    ui.info(`Skipped ${destination} (exists).`);
    return;
  }

  const data = await readStdinBuffer();
  echoResolved(ctx, `cp - ${destArg}`, destination);
  if (opts.dryRun) {
    ui.info(`Dry run — ${data.length} byte(s) would be written to ${destination}.`);
    return;
  }

  try {
    await withRetry(() =>
      puter.fs.write(destination, data, {
        overwrite: !opts.noClobber,
        dedupeName: false,
        createMissingParents: true,
      }),
    );
  } catch (err) {
    throw wrap(err, `Could not write '${destArg}'`);
  }
  ui.success(`Wrote ${data.length} byte(s) to ${destination}.`);
}

export async function fsCp(sourceArg, destArg, opts) {
  if (destArg === undefined) {
    throw new CLIError('cp needs a source and a destination.', {
      hint: 'Usage: puter fs cp <source> <destination>',
    });
  }
  // Everything that doesn't need the network happens before authenticating,
  // so an impossible pair or a missing local file fails immediately.
  const direction = copyDirection(sourceArg, destArg);
  for (const operand of [sourceArg, destArg]) {
    if (isRemote(operand)) assertRemoteOperand(operand);
  }
  if (direction === 'upload') statLocal(path.resolve(sourceArg), sourceArg);
  const concurrency = parseConcurrency(opts.concurrency);
  const ctx = await connect(opts);
  // commander reports the negatable `--no-clobber` as `clobber: false`.
  ctx.opts = { ...opts, noClobber: opts.clobber === false };

  switch (direction) {
    case 'upload':
      return uploadLocal(ctx, sourceArg, destArg, concurrency);
    case 'download':
      return downloadRemote(ctx, sourceArg, destArg, concurrency);
    case 'remoteCopy':
      return copyWithinDrive(ctx, sourceArg, destArg);
    case 'writeStdin':
      return writeStdinTo(ctx, destArg);
    case 'readStdout':
      return catRemote(ctx, sourceArg);
    default:
      throw new CLIError(`Unsupported copy: '${sourceArg}' → '${destArg}'.`);
  }
}

// --- mv --------------------------------------------------------------------

export async function fsMv(sourceArg, destArg, opts) {
  if (destArg === undefined) {
    throw new CLIError('mv needs a source and a destination.', {
      hint: 'Usage: puter fs mv <source> <destination>',
    });
  }
  assertMovable(sourceArg, destArg);
  assertRemoteOperand(sourceArg);
  assertRemoteOperand(destArg);
  const ctx = await connect(opts);

  const source = resolveRemote(sourceArg, ctx.root);
  const destination = resolveRemote(destArg, ctx.root);
  if (isRoot(source, ctx.root)) {
    throw new CLIError(`Refusing to move ${sourceArg} — that is the root itself.`);
  }
  await statRemote(ctx.puter, source, sourceArg);

  echoResolved(ctx, `mv ${sourceArg} ${destArg}`, destination);

  // move() works out on its own whether the destination is a directory to
  // move into or the item's new path.
  try {
    await withRetry(() =>
      ctx.puter.fs.move(source, destination, {
        overwrite: true,
        dedupeName: false,
      }),
    );
  } catch (err) {
    throw wrap(err, `Could not move '${sourceArg}'`);
  }
  ui.success(`Moved to ${destination}.`);
}

// --- rm --------------------------------------------------------------------

export async function fsRm(pathArg, opts) {
  assertRemoteOperand(pathArg);
  const ctx = await connect(opts);
  const target = resolveRemote(pathArg, ctx.root);

  if (isRoot(target, ctx.root)) {
    throw new CLIError(
      `Refusing to delete ${pathArg} — that is ${ctx.label ? `all of ${ctx.label}` : 'the whole drive'}.`,
      { hint: 'Name something inside it instead.' },
    );
  }

  const info = await statRemote(ctx.puter, target, pathArg);
  if (info.is_dir && !opts.recursive) {
    throw new CLIError(
      `'${pathArg}' is a directory — pass -r to remove it and its contents.`,
    );
  }

  if (opts.dryRun) {
    if (info.is_dir) {
      for (const entry of await listAll(ctx.puter, { path: target, recursive: true })) {
        ui.out(entry.path);
      }
    }
    ui.out(info.path ?? target);
    ui.info('Dry run — nothing was deleted.');
    return;
  }

  // What is about to go, in resolved terms, before anything goes.
  const count = info.is_dir ? await countEntries(ctx.puter, target) : 0;
  const what = info.is_dir
    ? `${target} (${count} ${count === 1 ? 'entry' : 'entries'})`
    : target;
  if (opts.recursive || ctx.label) {
    ui.status(
      `rm ${opts.recursive ? '-r ' : ''}${pathArg} → ${what}` +
        `${ctx.label ? ` ${ui.dim(`[${ctx.label}]`)}` : ''}`,
    );
  }

  if (opts.recursive && !opts.yes) {
    if (!canPrompt()) {
      throw new CLIError('Refusing to delete recursively without confirmation.', {
        hint: 'Pass --yes to confirm, or --dry-run to see what would go.',
      });
    }
    const go = await clack.confirm({
      message: `Delete ${target} and its ${count} entr${count === 1 ? 'y' : 'ies'}?`,
      initialValue: false,
    });
    if (clack.isCancel(go) || !go) throw new CLIError('Cancelled.');
  }

  // The SDK deletes recursively by default; a plain `rm` must say otherwise.
  try {
    await withRetry(() =>
      ctx.puter.fs.delete(target, { recursive: Boolean(opts.recursive) }),
    );
  } catch (err) {
    throw wrap(err, `Could not delete '${pathArg}'`);
  }
  ui.success(`Deleted ${target}.`);
}

// --- mkdir -----------------------------------------------------------------

export async function fsMkdir(pathArg, opts) {
  assertRemoteOperand(pathArg);
  const ctx = await connect(opts);
  const target = resolveRemote(pathArg, ctx.root);
  if (isRoot(target, ctx.root)) {
    throw new CLIError(`${pathArg} already exists.`);
  }

  echoResolved(ctx, `mkdir ${pathArg}`, target);

  let item;
  try {
    item = await withRetry(() =>
      ctx.puter.fs.mkdir(target, {
        createMissingParents: Boolean(opts.parents),
        dedupeName: false,
      }),
    );
  } catch (err) {
    throw wrap(err, `Could not create '${pathArg}'`);
  }
  ui.out(item?.path ?? target);
}

// --- stat ------------------------------------------------------------------

export async function fsStat(pathArg, opts) {
  assertRemoteOperand(pathArg);
  const ctx = await connect(opts);
  const target = resolveRemote(pathArg, ctx.root);
  const info = await statRemote(ctx.puter, target, pathArg);

  if (opts.json) {
    ui.out(JSON.stringify(info, null, 2));
    return;
  }

  ui.out(`path:     ${info.path ?? target}`);
  ui.out(`type:     ${info.is_dir ? 'directory' : (info.type ?? 'file')}`);
  if (!info.is_dir) {
    ui.out(`size:     ${info.size ?? 0} (${formatSize(Number(info.size))})`);
  }
  ui.out(`modified: ${formatTime(info.modified)}`);
  if (info.created) ui.out(`created:  ${formatTime(info.created)}`);
  if (info.uid) ui.out(`uid:      ${info.uid}`);
  if (info.is_public) ui.out('public:   yes');
}
