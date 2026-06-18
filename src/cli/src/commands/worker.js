import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';

import { isInteractive, WORKER_DOMAIN } from '../lib/env.js';
import { ensureClient } from '../lib/auth.js';
import { randName } from '../lib/client.js';
import { CLIError } from '../lib/errors.js';
import * as ui from '../lib/ui.js';

function bail(value) {
  if (clack.isCancel(value)) throw new CLIError('Cancelled.');
  return value;
}

// Workers are served at <name>.puter.work (the SDK lowercases the name).
function workerUrl(name) {
  return `https://${String(name).toLowerCase()}.${WORKER_DOMAIN}`;
}

function nameError(s) {
  if (!s) return 'Name is required.';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(s)) {
    return 'Use only letters, numbers and hyphens (not at the ends).';
  }
  return undefined;
}

// --- deploy (spec §6): get-first, then branch -----------------------------

export async function workerDeploy(fileArg, nameArg, opts) {
  const interactive = isInteractive();

  if (!interactive && (!fileArg || !nameArg)) {
    throw new CLIError(
      'Both a file and name are required in non-interactive mode.',
      { hint: 'Usage: puter worker deploy <file> <name>' },
    );
  }

  // Resolve + validate entry file before auth (no cwd-equivalent default).
  let fileInput = fileArg;
  if (!fileInput && interactive) {
    fileInput = bail(
      await clack.text({
        message: "Worker's JavaScript file",
        validate: (v) => (v && v.trim() ? undefined : 'A file is required'),
      }),
    );
  }
  const file = path.resolve(fileInput);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new CLIError(`No such file '${fileInput}'.`);
  }

  const puter = await ensureClient();

  // Resolve name.
  let name = nameArg;
  if (!name && interactive) {
    const suggested = await randName(puter);
    name = bail(
      await clack.text({
        message: 'Worker name',
        initialValue: suggested,
        validate: nameError,
      }),
    );
  }
  const nameErr = nameError(name);
  if (nameErr) throw new CLIError(`Invalid name: ${nameErr}`);

  ui.status(`Deploying ${ui.bold(fileInput)} → worker ${ui.bold(name)}`);

  // 1. Does it already exist?
  let existing = null;
  try {
    existing = await puter.workers.get(name);
  } catch {
    existing = null;
  }

  // 2/3. Overwrite the backing file in place; register only if new.
  const remotePath = `~/Workers/${name}.js`;
  const code = fs.readFileSync(file);
  const sp = ui.spinner('Uploading worker...');
  let created = null;
  try {
    await puter.fs.write(remotePath, code, {
      overwrite: true,
      createMissingParents: true,
    });
    if (!existing) {
      created = await puter.workers.create(name, remotePath);
      sp.stop('Worker created.');
    } else {
      sp.stop('Worker file updated.');
    }
  } catch (err) {
    sp.stop('Deploy failed.');
    throw new CLIError(`Deploy failed: ${err.message}`);
  }

  // Beta caveat (spec §6 / §9): no liveness signal to confirm the deploy.
  ui.warn(
    'Beta: there is no readiness signal yet, so an effective deploy cannot be confirmed.',
  );
  // Prefer the URL the API returns; fall back to the canonical form.
  ui.out(created?.url ?? existing?.url ?? workerUrl(name));
}

// --- list / get / delete --------------------------------------------------

export async function workerList() {
  const puter = await ensureClient();
  const workers = (await puter.workers.list()) ?? [];

  if (workers.length === 0) {
    ui.info('No workers yet. Deploy one with: puter worker deploy');
    return;
  }
  for (const w of workers) {
    const name = w?.name ?? String(w);
    ui.out(`${name}\t${ui.url(w?.url ?? workerUrl(name))}`);
  }
}

export async function workerGet(nameArg) {
  const puter = await ensureClient();
  let worker;
  try {
    worker = await puter.workers.get(nameArg);
  } catch (err) {
    throw new CLIError(`Could not fetch '${nameArg}': ${err.message}`);
  }
  if (!worker) throw new CLIError(`Worker '${nameArg}' not found.`);

  ui.out(`name: ${worker.name ?? nameArg}`);
  ui.out(`url:  ${worker.url ?? workerUrl(worker.name ?? nameArg)}`);
  if (worker.file_path || worker.path) {
    ui.out(`file: ${worker.file_path ?? worker.path}`);
  }
}

export async function workerDelete(nameArg, opts) {
  const puter = await ensureClient();

  if (isInteractive() && !opts.yes) {
    const go = bail(
      await clack.confirm({
        message: `Delete worker '${nameArg}'?`,
        initialValue: false,
      }),
    );
    if (!go) throw new CLIError('Cancelled.');
  }

  // Delete the worker first, then its backing file (the order the platform
  // wants: unregister before removing the file it points at).
  try {
    await puter.workers.delete(nameArg);
  } catch (err) {
    throw new CLIError(`Could not delete '${nameArg}': ${err.message}`);
  }

  const remotePath = `~/Workers/${nameArg}.js`;
  try {
    await puter.fs.delete(remotePath);
  } catch (err) {
    // Worker is already gone; the file may not exist or have a different name.
    ui.warn(`Worker deleted, but could not remove ${remotePath}: ${err?.message ?? err}`);
  }

  ui.success(`Deleted worker '${nameArg}'.`);
}
