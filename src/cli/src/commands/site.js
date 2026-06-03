import fs from 'node:fs';
import path from 'node:path';
import * as clack from '@clack/prompts';

import { isInteractive, SITE_DOMAIN } from '../lib/env.js';
import { ensureClient } from '../lib/auth.js';
import { randName } from '../lib/client.js';
import { walk } from '../lib/fswalk.js';
import { CLIError } from '../lib/errors.js';
import * as ui from '../lib/ui.js';

// --- subdomain helpers (spec §5.3): liberal in, strict out ----------------

function normalizeSubdomain(input) {
  let s = String(input).trim().toLowerCase();
  // accept a pasted full host like "my-app.puter.site"
  const suffix = `.${SITE_DOMAIN}`;
  if (s.endsWith(suffix)) s = s.slice(0, -suffix.length);
  return s;
}

function subdomainError(s) {
  if (!s) return 'Subdomain is required.';
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)) {
    return 'Use only lowercase letters, numbers and hyphens (not at the ends).';
  }
  return undefined;
}

function siteUrl(subdomain) {
  return `https://${subdomain}.${SITE_DOMAIN}`;
}

function bail(value) {
  if (clack.isCancel(value)) throw new CLIError('Cancelled.');
  return value;
}

// OS/junk files the platform ignores (uploading only these yields an empty
// batch → EMPTY_UPLOAD), so we strip them before uploading.
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.localized']);

function isIgnored(relPath) {
  return IGNORED_NAMES.has(relPath.split('/').pop());
}

// Build a File the SDK's upload() accepts, preserving the file's relative path
// so nested directories are recreated. The SDK overwrites .filepath/.fullPath
// with the basename but reads .finalPath first, so that's where the rel path
// has to go.
function toUploadFile(buf, relPath) {
  const file = new File([buf], relPath.split('/').pop());
  file.finalPath = relPath;
  return file;
}

// --- deploy (spec §5.5) ---------------------------------------------------

export async function siteDeploy(dirArg, subArg, opts) {
  const interactive = isInteractive();

  // Non-interactive: both positionals are required (spec §5.1).
  if (!interactive && (!dirArg || !subArg)) {
    throw new CLIError(
      'Both a directory and subdomain are required in non-interactive mode.',
      { hint: 'Usage: puter site deploy <dir> <subdomain>' },
    );
  }

  // 1a. Resolve + validate directory (before auth, so the footgun hint shows
  // even when not logged in; the dir prompt doesn't need a client).
  let dirInput = dirArg;
  if (!dirInput && interactive) {
    dirInput = bail(
      await clack.text({ message: 'Directory to deploy', initialValue: '.' }),
    );
  }
  const dir = path.resolve(dirInput);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    // Positional footgun mitigation (spec §5.4): a lone arg is the directory.
    throw new CLIError(`No such directory '${dirInput}'.`, {
      hint: `(To deploy the current folder to that subdomain, run: puter site deploy . ${dirInput})`,
    });
  }

  const puter = await ensureClient();

  // 1b. Resolve + validate subdomain (re-prompt interactively).
  let subdomain;
  if (subArg) {
    subdomain = normalizeSubdomain(subArg);
    const err = subdomainError(subdomain);
    if (err) throw new CLIError(`Invalid subdomain: ${err}`);
  } else if (interactive) {
    const suggested = await randName(puter);
    subdomain = normalizeSubdomain(
      bail(
        await clack.text({
          message: `Subdomain (.${SITE_DOMAIN})`,
          initialValue: suggested,
          validate: (v) => subdomainError(normalizeSubdomain(v)),
        }),
      ),
    );
  }

  // Collect files, dropping OS junk the platform ignores.
  const files = walk(dir).filter((f) => !isIgnored(f.rel));

  // Empty-directory guard.
  if (files.length === 0) {
    if (interactive) {
      const go = bail(
        await clack.confirm({
          message: `'${dirInput}' has no uploadable files. Deploy anyway?`,
          initialValue: false,
        }),
      );
      if (!go) throw new CLIError('Cancelled.');
    } else {
      ui.warn(`'${dirInput}' has no uploadable files — deploying anyway.`);
    }
  }

  // 2. Echo resolved values (spec §5.2) then act.
  ui.status(`Deploying ${ui.bold(dirInput)} → ${ui.bold(siteUrl(subdomain).replace('https://', ''))}`);

  ui.debug('resolved dir:', dir);
  ui.debug('subdomain:', subdomain);
  ui.debug(`uploading ${files.length} file(s):`);
  for (const f of files) ui.debug('  -', f.rel);

  // 3. Atomic, versioned folder (spec §5.6). dedupeName and createMissingParents
  // conflict: createMissingParents gives mkdir `-p` semantics, so when the
  // `deployment` folder already exists the server returns it as-is instead of
  // deduping — clobbering the previous version. So we ensure the parent exists
  // first (tolerating "already exists"), then create the deployment folder with
  // dedupe only. Each deploy then gets its own auto-numbered folder
  // (deployment, deployment (1), ...) and older versions are preserved.
  try {
    await puter.fs.mkdir(`~/Sites/${subdomain}`, { createMissingParents: true });
  } catch (err) {
    // Parent already exists (the common case after the first deploy) — fine.
    ui.debug('parent mkdir note:', err?.message ?? JSON.stringify(err));
  }
  const folder = await puter.fs.mkdir(`~/Sites/${subdomain}/deployment`, {
    dedupeName: true,
  });
  const targetPath = folder?.path ?? folder;
  ui.debug('mkdir returned:', JSON.stringify(folder));
  ui.debug('target path:', targetPath);

  // 4. Upload the whole tree in one batch. Each File carries its relative path
  // (via finalPath) so nested folders are recreated under targetPath;
  // createMissingParents builds those intermediate folders server-side.
  const items = files.map((f) => toUploadFile(fs.readFileSync(f.full), f.rel));
  const sp = ui.spinner(`Uploading ${items.length} file(s)...`);
  try {
    await puter.fs.upload(items, targetPath, {
      overwrite: true,
      createMissingParents: true,
    });
    sp.stop(`Uploaded ${items.length} file(s).`);
  } catch (err) {
    sp.stop('Upload failed.');
    ui.debug('upload error object:', JSON.stringify(err));
    throw new CLIError(`Upload failed: ${err.message ?? JSON.stringify(err)}`);
  }

  // 5. Point the subdomain at the new folder.
  let existing = null;
  try {
    existing = await puter.hosting.get(subdomain);
  } catch {
    existing = null; // treat "not found" as creatable
  }

  if (existing) {
    if (interactive) {
      const go = bail(
        await clack.confirm({
          message: `Update existing site '${subdomain}' to this deploy?`,
          initialValue: true,
        }),
      );
      if (!go) throw new CLIError('Cancelled.');
    }
    await puter.hosting.update(subdomain, targetPath);
  } else {
    try {
      await puter.hosting.create(subdomain, targetPath);
    } catch (err) {
      throw new CLIError(
        `Could not create subdomain '${subdomain}': ${err.message}`,
        { hint: 'It may be taken by another account — try a different name.' },
      );
    }
  }

  ui.success('Deployed.');
  ui.out(siteUrl(subdomain));
}

// --- list / get / delete --------------------------------------------------

export async function siteList() {
  const puter = await ensureClient();
  const sites = (await puter.hosting.list()) ?? [];

  if (sites.length === 0) {
    ui.info('No sites yet. Deploy one with: puter site deploy');
    return;
  }
  for (const s of sites) {
    const sub = s?.subdomain ?? s?.name ?? String(s);
    ui.out(`${sub}\t${ui.url(siteUrl(sub))}`);
  }
}

export async function siteGet(subdomainArg) {
  const puter = await ensureClient();
  const subdomain = normalizeSubdomain(subdomainArg);

  let site;
  try {
    site = await puter.hosting.get(subdomain);
  } catch (err) {
    throw new CLIError(`Could not fetch '${subdomain}': ${err.message}`);
  }
  if (!site) throw new CLIError(`Site '${subdomain}' not found.`);

  ui.out(`subdomain: ${site.subdomain ?? subdomain}`);
  ui.out(`url:       ${siteUrl(site.subdomain ?? subdomain)}`);
  const root = site.root_dir ?? site.path ?? site.dir_path;
  if (root) ui.out(`root:      ${typeof root === 'object' ? root.path : root}`);
}

export async function siteDelete(subdomainArg, opts) {
  const puter = await ensureClient();
  const subdomain = normalizeSubdomain(subdomainArg);

  if (isInteractive() && !opts.yes) {
    const go = bail(
      await clack.confirm({
        message: `Delete site '${subdomain}'? This removes the subdomain.`,
        initialValue: false,
      }),
    );
    if (!go) throw new CLIError('Cancelled.');
  }

  try {
    await puter.hosting.delete(subdomain);
  } catch (err) {
    throw new CLIError(`Could not delete '${subdomain}': ${err.message}`);
  }
  ui.success(`Deleted '${subdomain}'.`);
}
