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
import { kvConnect } from '../src/commands/kv.js';
import {
  fsLs,
  fsCat,
  fsCp,
  fsMv,
  fsRm,
  fsMkdir,
  fsStat,
} from '../src/commands/fs.js';

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
  .description('Puter CLI — developer tooling from your terminal. (beta)')
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

// --- kv ---------------------------------------------------------------------

const kv = program
  .command('kv')
  .description("Explore an app's or worker's key-value store");

kv
  .command('connect')
  .description("Open an interactive shell against an app's or worker's KV store")
  .argument('<identifier>', 'app name, worker name or URL, or app uid')
  .action(action(kvConnect));

// --- fs ---------------------------------------------------------------------

const fsCmd = program
  .command('fs')
  .description('Work with files on your Puter drive (remote paths are puter:/...)');

// `--app` rebases puter:/ onto one app's storage directory. Flag only: because
// it changes what an absolute path means, it has to be visible in the command
// itself — an invisible default turns `rm -r puter:/dist` into a command whose
// target you can't work out by reading it.
const withApp = (cmd) =>
  cmd.option(
    '--app <id>',
    "resolve puter:/ against an app's storage (app name, uid, worker name or URL)",
  );

withApp(
  fsCmd
    .command('ls')
    .description('List a remote directory')
    .argument('<path>', 'remote path (puter:/...)')
    .option('-l, --long', 'show type, size and modification time')
    .option('--json', 'emit the full entries as JSON'),
).action(action(fsLs));

withApp(
  fsCmd
    .command('cat')
    .description("Write a remote file's contents to stdout")
    .argument('<path>', 'remote path (puter:/...)'),
).action(action(fsCat));

withApp(
  fsCmd
    .command('cp')
    .description('Copy between local and remote paths, or within the drive')
    .argument('<source>', "local path, puter:/... or '-' for stdin")
    .argument('<destination>', "local path, puter:/... or '-' for stdout")
    .option('-r, --recursive', 'copy directories')
    .option('-n, --no-clobber', 'skip files that already exist')
    .option('--concurrency <n>', 'parallel transfers (1-32, default 8)')
    .option('--dry-run', 'list what would be copied'),
).action(action(fsCp));

withApp(
  fsCmd
    .command('mv')
    .description('Move or rename within the drive')
    .argument('<source>', 'remote path (puter:/...)')
    .argument('<destination>', 'remote path (puter:/...)'),
).action(action(fsMv));

withApp(
  fsCmd
    .command('rm')
    .description('Delete a remote file or directory')
    .argument('<path>', 'remote path (puter:/...)')
    .option('-r, --recursive', 'remove a directory and its contents')
    .option('-y, --yes', 'skip confirmation')
    .option('--dry-run', 'list what would be deleted'),
).action(action(fsRm));

withApp(
  fsCmd
    .command('mkdir')
    .description('Create a remote directory')
    .argument('<path>', 'remote path (puter:/...)')
    .option('-p, --parents', 'create missing parents, and succeed if it exists'),
).action(action(fsMkdir));

withApp(
  fsCmd
    .command('stat')
    .description('Show details for one remote file or directory')
    .argument('<path>', 'remote path (puter:/...)')
    .option('--json', 'emit the full entry as JSON'),
).action(action(fsStat));

program.parseAsync(process.argv);
