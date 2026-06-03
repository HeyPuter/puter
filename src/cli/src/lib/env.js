// Environment / interactivity detection (spec §3).
//
// "Interactive" = we may prompt because a human is attached to both ends.
// stream.isTTY is `true` on a terminal and `undefined` otherwise, so we coerce
// with Boolean(...) rather than comparing === true.

export function isInteractive() {
  if (process.env.CI) return false; // respect the CI convention
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// Whether stdin specifically can be prompted on (the load-bearing check).
export function canPrompt() {
  if (process.env.CI) return false;
  return Boolean(process.stdin.isTTY);
}

// Spinners / animations / color are gated on stdout only — skip them when
// output is piped to a file even if stdin is still a terminal.
export function canAnimate() {
  return Boolean(process.stdout.isTTY) && !process.env.CI;
}

// Default API + hosting endpoints, overridable for self-hosted instances.
export const API_ORIGIN =
  process.env.PUTER_API_ORIGIN || 'https://api.puter.com';
export const SITE_DOMAIN =
  process.env.PUTER_SITE_DOMAIN || 'puter.site';
export const WORKER_DOMAIN =
  process.env.PUTER_WORKER_DOMAIN || 'puter.work';
