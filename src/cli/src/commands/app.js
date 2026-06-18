// Read-only for beta (spec §7). An "app" is a registered desktop-OS entry on
// top of hosting; defining "app deploy" is deferred.

import { ensureClient } from '../lib/auth.js';
import { CLIError } from '../lib/errors.js';
import * as ui from '../lib/ui.js';

function appsApi(puter) {
  const api = puter.apps ?? puter.app;
  if (!api || typeof api.list !== 'function') {
    throw new CLIError('App commands are not available in this SDK build.');
  }
  return api;
}

export async function appList() {
  const puter = await ensureClient();
  const apps = (await appsApi(puter).list()) ?? [];

  if (apps.length === 0) {
    ui.info('No apps.');
    return;
  }
  for (const a of apps) {
    const name = a?.name ?? String(a);
    ui.out(a?.title ? `${name}\t${ui.dim(a.title)}` : name);
  }
}

export async function appGet(nameArg) {
  const puter = await ensureClient();
  let app;
  try {
    app = await appsApi(puter).get(nameArg);
  } catch (err) {
    throw new CLIError(`Could not fetch '${nameArg}': ${err.message}`);
  }
  if (!app) throw new CLIError(`App '${nameArg}' not found.`);

  ui.out(`name:  ${app.name ?? nameArg}`);
  if (app.title) ui.out(`title: ${app.title}`);
  if (app.index_url || app.url) ui.out(`url:   ${app.index_url ?? app.url}`);
}
