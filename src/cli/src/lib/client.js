// Puter.js SDK bootstrap for Node.
//
// The SDK ships a CommonJS entry (`init.cjs`); we're an ESM package, so it's
// loaded via createRequire. `init(token)` returns a configured `puter` object
// exposing .auth / .fs / .hosting / .workers, etc.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let sdk;
function loadSdk() {
  if (sdk) return sdk;
  try {
    sdk = require('@heyputer/puter.js/src/init.cjs');
  } catch (err) {
    throw new Error(
      `Could not load the Puter.js SDK (@heyputer/puter.js). ` +
        `Run \`npm install\` in the CLI directory.\n${err.message}`,
    );
  }
  return sdk;
}

// The SDK's Node XMLHttpRequest shim (xhrshim.js) calls
// `resp.headers.get('content-type').includes(...)` with no null-guard, which
// throws when a response omits Content-Type — exactly what the signed-URL PUT
// uploads (the fast, parallel signed-batch-write path) return. Patch the global
// Headers.get so a missing content-type reads as '' instead of null; this keeps
// the fast upload path working. Idempotent. Remove once the SDK null-guards it.
function patchHeadersContentType() {
  if (typeof Headers === 'undefined') return;
  if (Headers.prototype.__puterCliContentTypePatched) return;
  const original = Headers.prototype.get;
  Headers.prototype.get = function (name) {
    const value = original.call(this, name);
    if (value === null && String(name).toLowerCase() === 'content-type') {
      return '';
    }
    return value;
  };
  Headers.prototype.__puterCliContentTypePatched = true;
}

// Build an authenticated client from a token.
export function makeClient(token) {
  const { init } = loadSdk();
  patchHeadersContentType();
  return init(token);
}

// Browser-based auth flow (used by interactive `login`). Returns a token.
export async function getAuthTokenViaBrowser() {
  const { getAuthToken } = loadSdk();
  if (typeof getAuthToken !== 'function') {
    throw new Error('Web login is not available in this SDK build.');
  }
  return getAuthToken();
}

// Best-effort random domain-safe name from the SDK, with a local fallback
// so prompts still get a sensible pre-fill if randName is unavailable.
const ADJ = ['swift', 'brave', 'lucky', 'calm', 'bright', 'bold', 'sunny', 'cosmic'];
const NOUN = ['otter', 'falcon', 'maple', 'comet', 'harbor', 'cedar', 'pixel', 'delta'];

export async function randName(puter) {
  try {
    if (puter && typeof puter.randName === 'function') {
      const n = puter.randName();
      return n && typeof n.then === 'function' ? await n : n;
    }
  } catch {
    // fall through to local generator
  }
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  const suffix = Math.floor(Math.random() * 9000) + 1000;
  return `${a}-${n}-${suffix}`;
}
