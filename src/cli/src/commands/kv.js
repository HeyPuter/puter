// `puter kv connect <identifier>` — an interactive shell against one app's
// key-value store, named by app, by worker — name or URL, both resolving to
// the app behind the worker — or by uid.
//
// The REPL is Node's own (multiline, history, Ctrl-C/Ctrl-D, `_` and
// util.inspect formatting come free); we only add two things on top:
// results are awaited before they're echoed, so `get("x")` prints the value
// rather than `Promise { <pending> }`, and failures print one line instead of
// a stack.

import path from 'node:path';
import repl from 'node:repl';

import { appsApi } from '../lib/apps.js';
import { ensureClient } from '../lib/auth.js';
import { configPath } from '../lib/config.js';
import { isInteractive, WORKER_DOMAIN } from '../lib/env.js';
import { CLIError, messageOf } from '../lib/errors.js';
import { bindApp, KV_METHODS } from '../lib/kvbind.js';
import * as ui from '../lib/ui.js';

// How far we count keys on connect. An exact total would mean `includeTotal`,
// which runs a metered count over every key in the store, so we probe one page
// instead and say "100+" when it fills.
const PROBE_LIMIT = 100;

const APPS_HINT = "Run 'puter app list' to see your apps.";
const WORKERS_HINT = "Run 'puter worker list' to see your workers.";
const TARGET_HINT =
  "Run 'puter app list' or 'puter worker list' to see what you can connect to.";

// A worker URL identifies a worker as well as its name does — copy one out of
// `puter worker list` or the browser and it connects. Returns the worker name,
// or null when the argument isn't a worker URL.
function workerNameFromUrl(arg) {
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
// with it a key-value store of its own — so a worker name resolves to the uid
// of that app. Returns null when the account has no worker by that name.
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
  // of their own — they read and write the store of whoever deployed them.
  if (!worker.app_uid) {
    throw new CLIError(
      `Worker '${worker.name ?? nameArg}' has no store of its own: it is not sandboxed.`,
      { hint: 'Connect to the app that owns it instead.' },
    );
  }
  return { name: worker.name ?? nameArg, uid: worker.app_uid, kind: 'worker' };
}

// Accept an app name, a worker name, a worker URL, or the uid itself, so a uid
// pasted from `puter app list` (or the MCP tools) doesn't need a lookup. An app
// name wins a tie with a worker of the same name — the worker's own URL is the
// way to ask for the worker instead.
async function resolveTarget(puter, identifier) {
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

// One round-trip that both proves the store is reachable and gives us
// something to put in the banner.
async function probeKeys(kv, label) {
  let page;
  try {
    page = await kv.list({ limit: PROBE_LIMIT + 1, fetchUntilFull: true });
  } catch (err) {
    throw new CLIError(
      `Could not read the key-value store for '${label}': ${messageOf(err)}`,
    );
  }

  const items = Array.isArray(page) ? page : (page?.items ?? []);
  if (items.length > PROBE_LIMIT) return `${PROBE_LIMIT}+ keys`;
  return `${items.length} ${items.length === 1 ? 'key' : 'keys'}`;
}

const HELP = `
kv methods — also available as kv.* and puter.kv.*

  get(key)                    set(key, value, [expireAt])
  list([pattern], [values])   del(key)
  incr(key, [amount])         decr(key, [amount])
  add(key, value)             remove(key, ...paths)
  update(key, pathMap)        flush()
  expire(key, ttl)            expireAt(key, timestamp)

Results are awaited for you, so \`get("k")\` prints the value. \`_\` holds the
last result. .clear resets the session, .exit (or Ctrl-D) quits.
`.trim();

// Resolves when the user leaves the REPL — action() force-exits the process
// as soon as a command's promise settles, so this one has to stay pending for
// the life of the session.
function startRepl({ kv, prompt }) {
  return new Promise((resolve) => {
    const server = repl.start({ prompt, useGlobal: false });

    // A failure is echoed as a value rather than thrown at the REPL: SDK
    // rejections are plain { message, code } objects, which the default
    // writer would dump as an object literal.
    const KV_ERROR = Symbol('kvError');
    const asError = (err) => ({ [KV_ERROR]: messageOf(err) });

    const baseWriter = server.writer;
    server.writer = (value) =>
      value?.[KV_ERROR] !== undefined
        ? `${ui.red('Error:')} ${value[KV_ERROR]}`
        : baseWriter.call(server, value);

    // Wrapped after start(): passing an `eval` to repl.start() would replace
    // the default one rather than layer on it.
    const defaultEval = server.eval;
    server.eval = (cmd, context, filename, cb) => {
      defaultEval.call(server, cmd, context, filename, (err, result) => {
        if (err) {
          // Recoverable means "incomplete input, keep buffering" — swallowing
          // it here would break multiline entirely.
          if (err instanceof repl.Recoverable) return cb(err);
          return cb(null, asError(err));
        }
        Promise.resolve(result).then(
          (value) => cb(null, value),
          (rejection) => cb(null, asError(rejection)),
        );
      });
    };

    // .clear builds a fresh context, so the bindings have to be reinstalled.
    const install = (context) => {
      for (const name of KV_METHODS) context[name] = kv[name];
      context.kv = kv;
      // A shim, not the real client: an unscoped puter.fs/puter.apps has no
      // business in an app-scoped shell.
      context.puter = { kv };
    };
    install(server.context);
    server.on('reset', install);

    server.defineCommand('help', {
      help: 'Show the kv methods',
      action() {
        this.output.write(`${HELP}\n`);
        this.displayPrompt();
      },
    });

    server.setupHistory(
      path.join(path.dirname(configPath), 'kv-history'),
      () => {}, // best effort; a read-only config dir shouldn't end the session
    );

    server.on('exit', resolve);
  });
}

export async function kvConnect(identifier) {
  if (!isInteractive()) {
    throw new CLIError('`puter kv connect` needs a terminal.', {
      hint: 'Run it from an interactive shell.',
    });
  }

  const puter = await ensureClient();
  const { name, uid, byUid, kind } = await resolveTarget(puter, identifier);
  const kv = bindApp(puter.kv, uid);
  const keys = await probeKeys(kv, name);

  // A uid is its own name here, so don't print it twice — and keep it out of
  // the prompt at full length, where it would dwarf what you type.
  const where = byUid ? '' : ` ${ui.dim(`(${uid})`)}`;
  const what = kind === 'worker' ? 'worker ' : '';
  ui.success(`Connected to ${what}${ui.bold(name)}${where} · ${keys}`);
  ui.info('.help for the kv methods, .exit to quit');

  // The prompt says which namespace the name came from: an app and a worker
  // can share a name, and only one of them is what you're typing against.
  const label = byUid
    ? `${uid.slice(0, 12)}…`
    : `${kind === 'worker' ? 'worker:' : ''}${name}`;
  await startRepl({ kv, prompt: `kv(${label})> ` });
}
