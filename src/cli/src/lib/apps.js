// Access to the SDK's apps module. Older/partial SDK builds expose it under a
// different name (or not at all), so every caller goes through this guard.

import { CLIError } from './errors.js';

export function appsApi(puter) {
  const api = puter.apps ?? puter.app;
  if (!api || typeof api.list !== 'function') {
    throw new CLIError('App commands are not available in this SDK build.');
  }
  return api;
}
