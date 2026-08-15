// Binds puter.kv to one app's store.
//
// A user token can address another app's key-value store by passing
// `optConfig: { appUuid }` into the driver call — the backend pins app-scoped
// tokens to their own app but honors the override for a user token, which is
// what the CLI carries. (src/mcp-connector/src/tools.js does the same thing
// for the MCP tools.)
//
// The wrinkle is that optConfig sits in a different argument slot for every
// method — trailing after the paths for remove(), after the optional numeric
// expireAt/ttl for set()/update(), in the amount slot for incr()/decr(), and
// so on. Rather than encode twelve slot positions, we rely on the fact that
// every method already accepts optConfig as a *trailing* argument (see
// src/puter-js/src/modules/kv/lib/args.js), and only special-case the object
// form, where the config belongs inside the options object instead.
//
// These wrappers never print: the REPL echoes results itself, and a log here
// would double every line.

import { CLIError } from './errors.js';

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// `{ appUuid }` in a trailing slot is the SDK's optConfig shorthand — if the
// caller wrote one themselves, they meant it, so we leave the call alone.
const hasAppUuid = (v) =>
  isPlainObject(v) && Object.prototype.hasOwnProperty.call(v, 'appUuid');

// Options-object form: fold the app into the object's own optConfig. A
// caller-supplied appUuid wins over the connected one.
const intoOptions = (options, appUuid) => ({
  ...options,
  optConfig: { appUuid, ...(options.optConfig ?? {}) },
});

const appended = (args, appUuid) =>
  hasAppUuid(args[args.length - 1]) ? args : [...args, { appUuid }];

// Methods that take a single options object as an alternative to positional
// arguments. flush() belongs here too: flush({ optConfig }) is its object
// form, and the bare flush() falls through to the trailing-argument path,
// where a lone { appUuid } is read as the optConfig itself.
const objectForm = (fn, appUuid) => (...args) => {
  if (args.length === 1 && isPlainObject(args[0])) {
    return fn(intoOptions(args[0], appUuid));
  }
  return fn(...appended(args, appUuid));
};

// remove()/expire()/expireAt() have no object form — remove() would read the
// object as its key, so never rewrite the first argument.
const trailingOnly = (fn, appUuid) => (...args) => fn(...appended(args, appUuid));

const OBJECT_FORM = [
  'set', 'get', 'del', 'incr', 'decr', 'add', 'update', 'list', 'flush',
];
const TRAILING_ONLY = ['remove', 'expire', 'expireAt'];

// Whether the module pre-binds its methods varies by SDK build — in the
// published bundle `get` is a plain class method that reaches for `this`, so
// calling it off the module (as these wrappers do) would throw. Bind it here
// and the difference stops mattering.
function methodOf(kv, name) {
  const fn = kv?.[name];
  if (typeof fn !== 'function') {
    throw new CLIError(`puter.kv.${name} is not available in this SDK build.`);
  }
  return fn.bind(kv);
}

/**
 * Wrap the SDK's kv module so every call is scoped to `appUuid`.
 *
 * @param {object} kv - puter.kv
 * @param {string} appUuid - the connected app's uid
 * @returns {object} the same method names, app-scoped
 */
export function bindApp(kv, appUuid) {
  const bound = {};
  for (const name of OBJECT_FORM) {
    bound[name] = objectForm(methodOf(kv, name), appUuid);
  }
  for (const name of TRAILING_ONLY) {
    bound[name] = trailingOnly(methodOf(kv, name), appUuid);
  }
  // Same invariant the SDK keeps: puter.kv.clear === puter.kv.flush.
  bound.clear = bound.flush;
  return bound;
}

// The methods exposed as bare globals in the REPL, in the order `.help`
// lists them.
export const KV_METHODS = [
  'set', 'get', 'list', 'del', 'incr', 'decr',
  'add', 'remove', 'update', 'flush', 'expire', 'expireAt',
];
