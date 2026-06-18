#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';

import { action } from '../src/lib/errors.js';
import { loginCommand } from '../src/commands/login.js';
import { logoutCommand } from '../src/commands/logout.js';
import { whoamiCommand } from '../src/commands/whoami.js';
import {
  siteDeploy,
  siteList,
  siteGet,
  siteDelete,
} from '../src/commands/site.js';
import {
  workerDeploy,
  workerList,
  workerGet,
  workerDelete,
} from '../src/commands/worker.js';
import { appList, appGet } from '../src/commands/app.js';

// The Puter.js SDK emits duplicate "stray" rejections for failed API calls in
// addition to rejecting the promise we await. We already route the awaited
// error through action()/fail(), so swallow the strays to avoid a hard crash.
// Set PUTER_DEBUG=1 to surface them.
process.on('unhandledRejection', (reason) => {
  if (process.env.PUTER_DEBUG) console.error('unhandledRejection:', reason);
});

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('puter')
  .description('CLI for the Puter platform — deploy sites and workers. (beta)')
  .version(version, '-v, --version');

// --- auth ------------------------------------------------------------------

program
  .command('login')
  .description('Log in to Puter (web browser, or --with-token)')
  .option('--with-token', 'read an auth token from stdin')
  .action(action(loginCommand));

program
  .command('logout')
  .description('Clear the stored auth token')
  .action(action(logoutCommand));

program
  .command('whoami')
  .description('Show the current account')
  .action(action(whoamiCommand));

// --- site ------------------------------------------------------------------

const site = program.command('site').description('Manage static sites');

site
  .command('deploy')
  .description('Deploy a static directory to <subdomain>.puter.site')
  .argument('[dir]', 'directory to deploy')
  .argument('[subdomain]', 'target subdomain')
  .action(action(siteDeploy));

site
  .command('list')
  .description('List owned subdomains')
  .action(action(siteList));

site
  .command('get')
  .description('Show details for one subdomain')
  .argument('<subdomain>')
  .action(action(siteGet));

site
  .command('delete')
  .description('Remove a subdomain')
  .argument('<subdomain>')
  .option('-y, --yes', 'skip confirmation')
  .action(action(siteDelete));

// --- worker ----------------------------------------------------------------

const worker = program.command('worker').description('Manage serverless workers');

worker
  .command('deploy')
  .description('Deploy or replace a serverless worker')
  .argument('[file]', "worker's JS file")
  .argument('[name]', 'worker name')
  .action(action(workerDeploy));

worker
  .command('list')
  .description('List workers')
  .action(action(workerList));

worker
  .command('get')
  .description('Show details for one worker')
  .argument('<name>')
  .action(action(workerGet));

worker
  .command('delete')
  .description('Delete a worker')
  .argument('<name>')
  .option('-y, --yes', 'skip confirmation')
  .action(action(workerDelete));

// --- app (read-only, beta) -------------------------------------------------

const app = program.command('app').description('Inspect apps (read-only)');

app
  .command('list')
  .description('List apps')
  .action(action(appList));

app
  .command('get')
  .description('Show details for one app')
  .argument('<name>')
  .action(action(appGet));

program.parseAsync(process.argv);
