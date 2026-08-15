// `puter kv connect <app>` — an interactive shell against one app's
// key-value store.
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
import { isInteractive } from '../lib/env.js';
import { CLIError, messageOf } from '../lib/errors.js';
import { bindApp, KV_METHODS } from '../lib/kvbind.js';
import * as ui from '../lib/ui.js';

// How far we count keys on connect. An exact total would mean `includeTotal`,
// which runs a metered count over every key in the store, so we probe one page
// instead and say "100+" when it fills.
const PROBE_LIMIT = 100;

const APPS_HINT = "Run 'puter app list' to see your apps.";

// Accept either an app name or the uid itself, so a uid pasted from
// `puter app list` (or the MCP tools) doesn't need a lookup.
async function resolveApp(puter, appArg) {
  if (/^app-/.test(appArg)) return { name: appArg, uid: appArg, byUid: true };

  let app;
  try {
    app = await appsApi(puter).get(appArg);
  } catch (err) {
    throw new CLIError(`Could not fetch '${appArg}': ${messageOf(err)}`, {
      hint: APPS_HINT,
    });
  }
  if (!app?.uid) {
    throw new CLIError(`App '${appArg}' not found.`, { hint: APPS_HINT });
  }
  return { name: app.name ?? appArg, uid: app.uid };
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

export async function kvConnect(appArg) {
  if (!isInteractive()) {
    throw new CLIError('`puter kv connect` needs a terminal.', {
      hint: 'Run it from an interactive shell.',
    });
  }

  const puter = await ensureClient();
  const { name, uid, byUid } = await resolveApp(puter, appArg);
  const kv = bindApp(puter.kv, uid);
  const keys = await probeKeys(kv, name);

  // A uid is its own name here, so don't print it twice — and keep it out of
  // the prompt at full length, where it would dwarf what you type.
  const where = byUid ? '' : ` ${ui.dim(`(${uid})`)}`;
  ui.success(`Connected to ${ui.bold(name)}${where} · ${keys}`);
  ui.info('.help for the kv methods, .exit to quit');

  const label = byUid ? `${uid.slice(0, 12)}…` : name;
  await startRepl({ kv, prompt: `kv(${label})> ` });
}
