// Token storage (spec §4.3).
//
// Isolated accessors so logout/multi-account only ever touch this file.
// Stored in a future-proof multi-account shape from day one even though
// multi-account itself is deferred:
//
//   { "accounts": { "default": { "token": "..." } }, "active": "default" }
//
// Plaintext-with-permissions (chmod 0600) is the accepted bar for a deploy
// CLI; conf's encryptionKey is obfuscation, not security, so we don't use it.

import fs from 'node:fs';
import Conf from 'conf';

const config = new Conf({ projectName: 'puter-cli' });

export const configPath = config.path;

function lockDown() {
  // conf doesn't restrict permissions by default — owner read/write only.
  try {
    fs.chmodSync(config.path, 0o600);
  } catch {
    // best effort (e.g. Windows / file not yet flushed)
  }
}

function activeProfile() {
  return config.get('active') || 'default';
}

export function saveToken(token) {
  config.set('accounts.default.token', token);
  config.set('active', 'default');
  lockDown();
}

// The stored token only (no env). Used by `whoami`/`logout`-adjacent display.
export function getStoredToken() {
  return config.get(`accounts.${activeProfile()}.token`);
}

// Full resolution order for authenticated commands (spec §4.2):
//   1. PUTER_AUTH_TOKEN  2. stored token
export function getToken() {
  return process.env.PUTER_AUTH_TOKEN ?? getStoredToken();
}

export function clearToken() {
  config.delete(`accounts.${activeProfile()}.token`);
  lockDown();
}
