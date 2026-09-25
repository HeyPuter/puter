// Resolving "which app" from something a person can type: an app name, a
// worker name, a worker URL, or a uid. Shared by `puter kv connect` and
// `puter fs --app`, so both accept the same identifiers.

import { appsApi } from './apps.js';
import { WORKER_DOMAIN } from './env.js';
import { CLIError, messageOf } from './errors.js';

const APPS_HINT = "Run 'puter app list' to see your apps.";
const WORKERS_HINT = "Run 'puter worker list' to see your workers.";
const TARGET_HINT =
  "Run 'puter app list' or 'puter worker list' to see what you can connect to.";

// A worker URL identifies a worker as well as its name does — copy one out of
// `puter worker list` or the browser and it resolves. Returns the worker name,
// or null when the argument isn't a worker URL.
export function workerNameFromUrl(arg) {
  const host = String(arg)
    .trim()
    .replace(/^[a-z]+:\/\//i, '') // scheme
    .replace(/[/?#].*$/, '') // path, query, fragment
    .replace(/:\d+$/, '') // port
    .toLowerCase();

  const suffix = `.${WORKER_DOMAIN.toLowerCase()}`;
  if (!host.endsWith(suffix)) return null;
  const name = host.slice(0, -suffix.length);
  // Only the flat `<name>.puter.work` form — a deeper host isn't one of ours.
  return name && !name.includes('.') ? name : null;
}

// "No such app" is the cue to try a worker by the same name; anything else
// (offline, expired token) is a real failure and should be reported as one.
const isNotFound = (err) =>
  err?.code === 'not_found' || /not found/i.test(messageOf(err));

// A worker deployed from a user token gets its own `sandbox-<name>` app, and
// with it a key-value store and AppData directory of its own — so a worker
// name resolves to the uid of that app. Returns null when the account has no
// worker by that name.
async function resolveWorker(puter, nameArg) {
  let worker;
  try {
    worker = await puter.workers.get(nameArg);
  } catch (err) {
    throw new CLIError(
      `Could not fetch worker '${nameArg}': ${messageOf(err)}`,
      { hint: WORKERS_HINT },
    );
  }
  if (!worker) return null;

  // Workers deployed by an app (or with `sandbox: false`) have no app identity
  // of their own — they read and write the storage of whoever deployed them.
  if (!worker.app_uid) {
    throw new CLIError(
      `Worker '${worker.name ?? nameArg}' has no storage of its own: it is not sandboxed.`,
      { hint: 'Use the app that owns it instead.' },
    );
  }
  return { name: worker.name ?? nameArg, uid: worker.app_uid, kind: 'worker' };
}

// Accept an app name, a worker name, a worker URL, or the uid itself, so a uid
// pasted from `puter app list` (or the MCP tools) doesn't need a lookup. An app
// name wins a tie with a worker of the same name — the worker's own URL is the
// way to ask for the worker instead.
export async function resolveTarget(puter, identifier) {
  // A URL says which namespace it belongs to, so it never falls back to an app.
  const fromUrl = workerNameFromUrl(identifier);
  if (fromUrl) {
    const worker = await resolveWorker(puter, fromUrl);
    if (!worker) {
      throw new CLIError(`Worker '${fromUrl}' not found.`, {
        hint: WORKERS_HINT,
      });
    }
    return worker;
  }

  if (/^app-/.test(identifier)) {
    return { name: identifier, uid: identifier, byUid: true };
  }

  let app;
  try {
    app = await appsApi(puter).get(identifier);
  } catch (err) {
    if (!isNotFound(err)) {
      throw new CLIError(`Could not fetch '${identifier}': ${messageOf(err)}`, {
        hint: APPS_HINT,
      });
    }
  }
  if (app?.uid) return { name: app.name ?? identifier, uid: app.uid };

  const worker = await resolveWorker(puter, identifier);
  if (worker) return worker;

  throw new CLIError(`No app or worker named '${identifier}'.`, {
    hint: TARGET_HINT,
  });
}
