// MCP tool definitions + handlers.
//
// Handlers receive the caller's REAL puter.js instance (the same `puter` object
// the in-repo worker exposes, created from the Authorization header) and call
// genuine puter.fs.* / puter.hosting.* methods.
//
// Each entry has a JSON-Schema `inputSchema` (advertised via tools/list) and a
// `handler(puter, args)`; the MCP layer wraps the return value into `content`.

/** Decode a base64 string into a Uint8Array (Workers have atob). */
function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/** Encode bytes to base64 (btoa is byte-unsafe for >0xFF, so chunk over a Uint8Array). */
function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/** Normalize puter.fs.read output (a Blob/Response-like) into text or base64. */
async function decodeReadResult(result, encoding) {
    let bytes;
    if (result instanceof Blob) {
        bytes = new Uint8Array(await result.arrayBuffer());
    } else if (result instanceof ArrayBuffer) {
        bytes = new Uint8Array(result);
    } else if (result instanceof Uint8Array) {
        bytes = result;
    } else if (typeof result === 'string') {
        if (encoding === 'base64') {
            bytes = new TextEncoder().encode(result);
        } else {
            return { content: result, encoding: 'utf8', bytes: result.length };
        }
    } else if (result && typeof result.arrayBuffer === 'function') {
        bytes = new Uint8Array(await result.arrayBuffer());
    } else {
        // Fallback: stringify whatever we got.
        const text = typeof result === 'object' ? JSON.stringify(result) : String(result);
        return { content: text, encoding: 'utf8', bytes: text.length };
    }

    if (encoding === 'base64') {
        return { content: bytesToBase64(bytes), encoding: 'base64', bytes: bytes.length };
    }
    return { content: new TextDecoder().decode(bytes), encoding: 'utf8', bytes: bytes.length };
}

// ----- puter.js documentation fetching -------------------------------------
// The puter_docs_* tools pull authoritative docs straight from docs.puter.com so
// an agent writes correct worker / SDK code instead of guessing the API.
const DOCS_HOST = 'docs.puter.com';
const DOCS_INDEX_URL = `https://${DOCS_HOST}/llms.txt`;

/** Resolve a docs topic/path to a canonical https://docs.puter.com/.../index.md URL. */
function resolveDocUrl(pathOrTopic) {
    let p = String(pathOrTopic || '').trim();
    if (!p || p === 'llms' || p === 'llms.txt') return DOCS_INDEX_URL;
    // Accept a full URL, but only on the docs host (avoid SSRF to arbitrary hosts).
    if (/^https?:\/\//i.test(p)) {
        const u = new URL(p);
        if (u.hostname !== DOCS_HOST) {
            throw new Error(`Only ${DOCS_HOST} documentation URLs are allowed.`);
        }
        return u.toString();
    }
    // Normalize a topic slug like "Workers/router" or "Workers/router/index.md".
    p = p.replace(/^\/+|\/+$/g, '').replace(/\/index\.md$/i, '').replace(/\.md$/i, '');
    if (!p) return DOCS_INDEX_URL;
    return `https://${DOCS_HOST}/${p}/index.md`;
}

// Worker public URLs live on subdomains of this suffix; workers_exec attaches
// the caller's Puter auth header, so it must never be sent to any other host.
const WORKER_HOST_SUFFIX = '.puter.work';

/** Validate that a workers_exec target is an https URL on a *.puter.work host. */
function assertWorkerUrl(url) {
    let u;
    try {
        u = new URL(url);
    } catch {
        throw new Error(`Invalid worker URL: ${url}`);
    }
    if (u.protocol !== 'https:' || !u.hostname.endsWith(WORKER_HOST_SUFFIX)) {
        throw new Error(`workers_exec can only call Puter Worker URLs (https://<worker>${WORKER_HOST_SUFFIX}/...).`);
    }
    return u;
}

/** Fetch a docs page as text, throwing a readable error on failure. */
async function fetchDocText(url) {
    const resp = await fetch(url, { headers: { accept: 'text/markdown, text/plain, */*' } });
    if (!resp.ok) {
        throw new Error(`Failed to fetch Puter docs (HTTP ${resp.status}) from ${url}`);
    }
    return resp.text();
}

// Every Puter path lives under the user's home directory (/<username>). Agents
// routinely guess bare root paths like "/portfolio/index.html", which do NOT
// exist — this note steers them to valid forms.
const HOME_PATH_NOTE =
    'Paths must live under your home directory: use "~/..." or "/<username>/..." ' +
    '(call whoami to get your <username>). Bare root paths like "/portfolio/index.html" are INVALID. Also, don\'t pollute the home directory. Create subpaths and folders for your projects.';

export const TOOLS = [
    // ----- account / identity ----------------------------------------------
    {
        name: 'whoami',
        description:
            'Get the authenticated Puter user\'s account info — including username, uuid, and the ' +
            'home_directory (/<username>) that ALL filesystem paths must live under. Call this first ' +
            'to learn your username so you can build valid absolute paths (e.g. "/<username>/portfolio/' +
            'index.html") instead of invalid bare root paths. Equivalent to PuterJS puter.auth.getUser().',
        inputSchema: { type: 'object', properties: {} },
        async handler(puter) {
            const user = await puter.auth.getUser();
            return user && user.username
                ? { ...user, home_directory: `/${user.username}` }
                : user;
        },
    },

    // ----- filesystem ------------------------------------------------------
    {
        name: 'fs_read_file',
        description:
            'Read the contents of a file in Puter. Returns UTF-8 text by default; ' +
            'pass encoding="base64" for binary files. Supports optional byte offset/length. ' +
            'Equivalent to PuterJS puter.fs.read(path).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `File path to read. ${HOME_PATH_NOTE}` },
                encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
                offset: { type: 'integer', minimum: 0, description: 'Byte offset to start reading from.' },
                length: { type: 'integer', minimum: 1, description: 'Maximum number of bytes to read.' },
            },
            required: ['path'],
        },
        async handler(puter, { path, encoding = 'utf8', offset, length }) {
            const options = {};
            if (offset != null) options.offset = offset;
            if (length != null) options.byte_count = length;
            const result = await puter.fs.read(path, options);
            const { content, encoding: enc, bytes } = await decodeReadResult(result, encoding);
            return { _meta: { encoding: enc, bytes }, text: content };
        },
    },
    {
        name: 'fs_stat',
        description: 'Get metadata (name, size, type, timestamps, uid) for a file or directory in Puter. Equivalent to PuterJS puter.fs.stat(path).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `Path to a file or directory. ${HOME_PATH_NOTE}` },
                return_size: { type: 'boolean', default: true, description: 'Compute size for directories.' },
            },
            required: ['path'],
        },
        async handler(puter, { path, return_size }) {
            return puter.fs.stat(path, { returnSize: return_size !== false });
        },
    },
    {
        name: 'fs_write_file',
        description:
            'Write (create or overwrite) a file in Puter. Provide content as UTF-8 text, ' +
            'or set encoding="base64" to write binary data. Equivalent to PuterJS puter.fs.write(path, data).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `Destination file path. ${HOME_PATH_NOTE}` },
                content: { type: 'string', description: 'File contents (UTF-8, or base64 if encoding=base64).' },
                encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
                overwrite: { type: 'boolean', default: true, description: 'Overwrite an existing file.' },
                create_missing_parents: {
                    type: 'boolean',
                    default: false,
                    description: 'Create missing parent directories.',
                },
                dedupe_name: {
                    type: 'boolean',
                    default: false,
                    description: 'Auto-rename instead of overwriting if the file exists.',
                },
            },
            required: ['path', 'content'],
        },
        async handler(puter, { path, content, encoding = 'utf8', overwrite = true, create_missing_parents = false, dedupe_name = false }) {
            const data = encoding === 'base64'
                ? new Blob([base64ToBytes(content)])
                : content;
            return puter.fs.write(path, data, {
                overwrite,
                dedupeName: dedupe_name,
                createMissingParents: create_missing_parents,
            });
        },
    },
    {
        name: 'fs_mkdir',
        description: 'Create a directory in Puter (optionally creating missing parents). Equivalent to PuterJS puter.fs.mkdir(path).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `Directory path to create. ${HOME_PATH_NOTE}` },
                create_missing_parents: {
                    type: 'boolean',
                    default: true,
                    description: 'Create intermediate directories as needed.',
                },
            },
            required: ['path'],
        },
        async handler(puter, { path, create_missing_parents }) {
            return puter.fs.mkdir(path, { createMissingParents: create_missing_parents !== false });
        },
    },
    {
        name: 'fs_delete',
        description: 'Delete a file or directory in Puter. Directories are removed recursively by default. Equivalent to PuterJS puter.fs.delete(path).',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    description: `Path (string) or list of paths to delete. ${HOME_PATH_NOTE}`,
                    anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
                },
                recursive: { type: 'boolean', default: true, description: 'Recurse into directories.' },
            },
            required: ['path'],
        },
        async handler(puter, { path, recursive }) {
            await puter.fs.delete(path, { recursive: recursive !== false });
            return { success: true, deleted: Array.isArray(path) ? path : [path] };
        },
    },
    {
        name: 'fs_readdir',
        description: 'List the entries (files and subdirectories) of a directory in Puter. Equivalent to PuterJS puter.fs.readdir(path).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `Directory path to list. ${HOME_PATH_NOTE}` },
            },
            required: ['path'],
        },
        async handler(puter, { path }) {
            return puter.fs.readdir(path);
        },
    },

    // ----- hosting / static websites (puter.hosting) -----------------------
    // In Puter, "hosting" means publishing a static website. Each website lives
    // at a subdomain of puter.site (e.g. "my-site" -> https://my-site.puter.site)
    // and is backed by a directory in the user's Puter filesystem. These tools
    // are how an agent puts files online: write the site's files with fs_write_file,
    // then hosting_create a subdomain pointing at that directory.
    {
        name: 'hosting_list',
        description:
            'List all websites (hosting subdomains) the authenticated Puter user has published. ' +
            'Each entry includes the subdomain (served at https://<subdomain>.puter.site) and the ' +
            'Puter directory it is hosted from. Use this to discover existing sites before creating ' +
            'or updating one. Equivalent to PuterJS puter.hosting.list().',
        inputSchema: { type: 'object', properties: {} },
        async handler(puter) {
            return puter.hosting.list();
        },
    },
    {
        name: 'hosting_get',
        description:
            'Get a single published website (hosting subdomain) by its subdomain label, including ' +
            'the Puter directory it serves from. The live site is reachable at ' +
            'https://<subdomain>.puter.site. Equivalent to PuterJS puter.hosting.get(subdomain).',
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'The subdomain label, e.g. "my-site" (without the .puter.site suffix).' },
            },
            required: ['subdomain'],
        },
        async handler(puter, { subdomain }) {
            return puter.hosting.get(subdomain);
        },
    },
    {
        name: 'hosting_create',
        description:
            'Publish a new static website by creating a hosting subdomain. The site goes live at ' +
            'https://<subdomain>.puter.site. Point it at a Puter directory (root_dir) to serve that ' +
            "directory's files (e.g. an index.html) as a website; omit root_dir to reserve the " +
            'subdomain and attach a directory later with hosting_update. Typical flow: fs_mkdir a ' +
            'directory, fs_write_file your index.html into it, then hosting_create with that root_dir. ' +
            'Equivalent to PuterJS puter.hosting.create(subdomain, root_dir).',
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: {
                    type: 'string',
                    description: 'Subdomain label for the site (lowercase letters, digits, hyphens; max 64 chars). The site will be served at https://<subdomain>.puter.site.',
                },
                root_dir: {
                    type: 'string',
                    description: 'Puter directory path whose files are served as the website (e.g. "~/my-site" or "/<username>/my-site"). Omit to create the subdomain without content for now.',
                },
            },
            required: ['subdomain'],
        },
        async handler(puter, { subdomain, root_dir }) {
            return root_dir
                ? puter.hosting.create(subdomain, root_dir)
                : puter.hosting.create(subdomain);
        },
    },
    {
        name: 'hosting_update',
        description:
            'Re-point an existing website (hosting subdomain) at a different Puter directory, changing ' +
            'which files https://<subdomain>.puter.site serves. Use this to attach content to a bare ' +
            'subdomain or to swap the served directory. Equivalent to PuterJS puter.hosting.update(subdomain, root_dir).',
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'The subdomain label of the site to update.' },
                root_dir: {
                    type: 'string',
                    description: 'New Puter directory path to serve the website from.',
                },
            },
            required: ['subdomain', 'root_dir'],
        },
        async handler(puter, { subdomain, root_dir }) {
            return puter.hosting.update(subdomain, root_dir);
        },
    },
    {
        name: 'hosting_delete',
        description:
            'Unpublish a website by deleting its hosting subdomain. This takes ' +
            'https://<subdomain>.puter.site offline but does NOT delete the underlying Puter directory ' +
            'or its files. Equivalent to PuterJS puter.hosting.delete(subdomain).',
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'The subdomain label of the site to unpublish.' },
            },
            required: ['subdomain'],
        },
        async handler(puter, { subdomain }) {
            return puter.hosting.delete(subdomain);
        },
    },

    // ----- serverless workers (puter.workers) ------------------------------
    // Puter Workers are serverless JavaScript functions deployed from a file in
    // the user's Puter filesystem. The worker file defines handlers on the global
    // `router` object (router.get/router.post/...) and has the full puter.js SDK
    // available as `puter`, authenticated as the deployer (`me.puter`) or, when
    // invoked via puter.workers.exec(), the calling user (`user.puter`). Workers
    // are designed to be used WITH puter.js and Puter authentication, NOT as plain
    // standalone HTTP handlers — always read the router guide (puter_docs_get
    // "Workers/router") before writing worker code.
    {
        name: 'workers_create',
        description:
            'Deploy a serverless Puter Worker from a JavaScript file in the Puter filesystem and ' +
            'return its public URL. The worker file MUST define handlers on the global `router` object ' +
            '(router.get/router.post/router.put/router.delete) and may use the global puter.js SDK ' +
            '(`puter`) for storage, KV, AI, and more — authenticated as you, the deployer. Puter Workers ' +
            'are designed to be used WITH puter.js and Puter authentication, so BEFORE writing worker ' +
            'code load the router guide and examples via puter_docs_get with path "Workers/router". ' +
            'Typical flow: fs_write_file the worker code to a path (e.g. "~/workers/api.js"), then ' +
            'workers_create with that file_path. TO UPDATE a deployed worker, simply write the new code ' +
            'to the SAME file with fs_write_file — there is no separate update call; the worker serves ' +
            'the current contents of its associated file (propagation takes ~5-30s). Requires a Puter ' +
            'account with a verified email. Equivalent to PuterJS puter.workers.create(worker_name, file_path).',
        inputSchema: {
            type: 'object',
            properties: {
                worker_name: {
                    type: 'string',
                    description: 'Worker name (letters, digits, hyphens, underscores). Lowercased automatically.',
                },
                file_path: {
                    type: 'string',
                    description: 'Path to the worker JS file in Puter (e.g. "~/workers/api.js" or "/<username>/workers/api.js"). The file must define handlers on the global `router` object. Max 10MB. Writing to this same path later updates the deployed worker.',
                },
            },
            required: ['worker_name', 'file_path'],
        },
        async handler(puter, { worker_name, file_path }) {
            return puter.workers.create(worker_name, file_path);
        },
    },
    {
        name: 'workers_list',
        description:
            'List all serverless Workers deployed by the authenticated Puter user, including each ' +
            "worker's name, public URL, and the source file it is deployed from (write to that file to " +
            'update the worker). Equivalent to PuterJS puter.workers.list().',
        inputSchema: { type: 'object', properties: {} },
        async handler(puter) {
            return puter.workers.list();
        },
    },
    {
        name: 'workers_get',
        description:
            'Get a single deployed Worker by name, including its public URL and the source file path it ' +
            'serves (write new code to that file with fs_write_file to update it). ' +
            'Equivalent to PuterJS puter.workers.get(worker_name).',
        inputSchema: {
            type: 'object',
            properties: {
                worker_name: { type: 'string', description: 'The worker name to look up.' },
            },
            required: ['worker_name'],
        },
        async handler(puter, { worker_name }) {
            return puter.workers.get(worker_name);
        },
    },
    {
        name: 'workers_exec',
        description:
            'Call a deployed Puter Worker over HTTP as the authenticated user, automatically attaching ' +
            "the Puter auth header so the worker can act on the caller's resources via `user.puter`. " +
            'Use this to invoke or test a worker endpoint. Equivalent to PuterJS puter.workers.exec(url, options).',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'Full worker URL including any path, e.g. "https://my-worker.puter.work/api/hello" (get the base URL from workers_get/workers_list). Must be an https URL on a *.puter.work host.',
                },
                method: {
                    type: 'string',
                    enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
                    default: 'GET',
                },
                headers: {
                    type: 'object',
                    description: 'Optional request headers.',
                    additionalProperties: { type: 'string' },
                },
                body: { type: 'string', description: 'Optional request body (for POST/PUT/PATCH).' },
            },
            required: ['url'],
        },
        async handler(puter, { url, method = 'GET', headers, body }) {
            assertWorkerUrl(url);
            const init = { method };
            if (headers) init.headers = headers;
            if (body != null && method !== 'GET' && method !== 'HEAD') init.body = body;
            const resp = await puter.workers.exec(url, init);
            const text = await resp.text();
            return { _meta: { status: resp.status, content_type: resp.headers.get('content-type') }, text };
        },
    },
    {
        name: 'workers_delete',
        description:
            'Delete (undeploy) a Puter Worker by name, stopping its execution and releasing its URL. Does ' +
            "NOT delete the worker's source file in the filesystem. Equivalent to PuterJS puter.workers.delete(worker_name).",
        inputSchema: {
            type: 'object',
            properties: {
                worker_name: { type: 'string', description: 'The worker name to delete.' },
            },
            required: ['worker_name'],
        },
        async handler(puter, { worker_name }) {
            const ok = await puter.workers.delete(worker_name);
            return { success: ok === true, deleted: worker_name };
        },
    },

    // ----- apps (puter.apps) -----------------------------------------------
    // A Puter "app" is a registered application in the user's account: it shows
    // up in their Puter app list, can be launched in the Puter desktop UI, and
    // (once approved) listed in the app marketplace. The core of an app is its
    // `index_url` — the URL Puter loads when the app runs. That URL is usually a
    // static site published with hosting_create (https://<subdomain>.puter.site)
    // or a serverless worker, but can be any allowed https URL. Typical flow:
    // fs_write_file the app's files -> hosting_create to publish them and get a
    // URL -> apps_create with index_url set to that URL so it becomes a
    // launchable Puter app. These tools manage only apps the user owns/can edit.
    {
        name: 'apps_list',
        description:
            'List the Puter apps the authenticated user owns / can edit. Each entry includes the app ' +
            'name, title, uid, index_url (the URL the app loads), icon, filetype associations, and ' +
            'aggregate usage stats (open_count, user_count). Use this to discover existing apps before ' +
            'creating or updating one. Equivalent to PuterJS puter.apps.list().',
        inputSchema: { type: 'object', properties: {} },
        async handler(puter) {
            return puter.apps.list();
        },
    },
    {
        name: 'apps_get',
        description:
            'Get a single Puter app the user owns / can edit, by its app name, including its title, uid, ' +
            'index_url, icon, and usage stats. Pass stats_period for detailed open/user counts over a ' +
            'specific window. Equivalent to PuterJS puter.apps.get(name).',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The app name (the unique slug, not the display title).' },
                stats_period: {
                    type: 'string',
                    enum: ['today', 'yesterday', '7d', '30d', 'this_week', 'last_week', 'this_month', 'last_month', 'this_year', 'last_year', '12m', 'all'],
                    description: 'Optional time window for detailed usage stats. Omit for default aggregate stats.',
                },
            },
            required: ['name'],
        },
        async handler(puter, { name, stats_period }) {
            const params = {};
            if (stats_period != null) params.stats_period = stats_period;
            return puter.apps.get(name, params);
        },
    },
    {
        name: 'apps_create',
        description:
            'Register a new Puter app so it appears in the user\'s app list and can be launched in Puter. ' +
            'You MUST provide a unique name and an index_url (the URL Puter loads when the app runs). ' +
            'The index_url is typically a static site you published with hosting_create ' +
            '(https://<subdomain>.puter.site) or a serverless worker URL, but can be any allowed https URL. ' +
            'Typical flow: fs_write_file the app files -> hosting_create to publish them -> apps_create with ' +
            'index_url set to the resulting URL. Equivalent to PuterJS puter.apps.create(spec).',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Unique app name / slug (letters, digits, hyphens, underscores; max 100 chars). Used to identify the app.',
                },
                index_url: {
                    type: 'string',
                    description: 'The https URL Puter loads when the app runs (e.g. "https://my-site.puter.site"). Get one by publishing a site with hosting_create or deploying a worker.',
                },
                title: { type: 'string', description: 'Human-friendly display title (max 100 chars). Defaults to name if omitted.' },
                description: { type: 'string', description: 'Longer description of the app (max 7000 chars).' },
                icon: {
                    type: 'string',
                    description: 'App icon as a base64 image string or a data:image/<type>;base64,... URL. Arbitrary http(s) icon URLs are NOT accepted.',
                },
                maximize_on_start: { type: 'boolean', description: 'Open the app maximized when launched.' },
                background: { type: 'boolean', description: 'Run the app in the background (no visible window).' },
                filetype_associations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'File extensions or MIME types this app can open (e.g. [".txt", ".md", "image/png"]).',
                },
                metadata: {
                    type: 'object',
                    description: 'Arbitrary developer metadata stored with the app.',
                    additionalProperties: true,
                },
                dedupe_name: {
                    type: 'boolean',
                    default: false,
                    description: 'If an app with this name exists, auto-rename the new app instead of failing.',
                },
            },
            required: ['name', 'index_url'],
        },
        async handler(puter, {
            name, index_url, title, description, icon,
            maximize_on_start, background, filetype_associations, metadata, dedupe_name,
        }) {
            return puter.apps.create({
                name,
                indexURL: index_url,
                title,
                description,
                icon,
                maximizeOnStart: maximize_on_start,
                background,
                filetypeAssociations: filetype_associations,
                metadata,
                dedupeName: dedupe_name,
            });
        },
    },
    {
        name: 'apps_update',
        description:
            'Update an existing Puter app, found by its current name. Only the fields you pass are changed; ' +
            'omitted fields keep their current values. Pass new_name to rename the app. Equivalent to ' +
            'PuterJS puter.apps.update(name, spec).',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The current name of the app to update.' },
                new_name: { type: 'string', description: 'New name / slug to rename the app to (letters, digits, hyphens, underscores; max 100 chars).' },
                index_url: { type: 'string', description: 'New https URL the app loads (e.g. a hosting_create or worker URL).' },
                title: { type: 'string', description: 'New display title (max 100 chars).' },
                description: { type: 'string', description: 'New description (max 7000 chars).' },
                icon: {
                    type: 'string',
                    description: 'New icon: base64 image string or data:image/<type>;base64,... URL. Arbitrary http(s) URLs are NOT accepted.',
                },
                maximize_on_start: { type: 'boolean', description: 'Open the app maximized when launched.' },
                background: { type: 'boolean', description: 'Run the app in the background (no visible window).' },
                filetype_associations: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'File extensions or MIME types this app can open.',
                },
                metadata: {
                    type: 'object',
                    description: 'Arbitrary developer metadata to store with the app.',
                    additionalProperties: true,
                },
            },
            required: ['name'],
        },
        async handler(puter, {
            name, new_name, index_url, title, description, icon,
            maximize_on_start, background, filetype_associations, metadata,
        }) {
            return puter.apps.update(name, {
                name: new_name,
                indexURL: index_url,
                title,
                description,
                icon,
                maximizeOnStart: maximize_on_start,
                background,
                filetypeAssociations: filetype_associations,
                metadata,
            });
        },
    },
    {
        name: 'apps_delete',
        description:
            'Delete a Puter app by name, removing it from the user\'s app list. This unregisters the app ' +
            'but does NOT delete the website/worker its index_url points to. Equivalent to ' +
            'PuterJS puter.apps.delete(name).',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The name of the app to delete.' },
            },
            required: ['name'],
        },
        async handler(puter, { name }) {
            const result = await puter.apps.delete(name);
            return { success: true, deleted: name, result };
        },
    },
    {
        name: 'apps_check_name',
        description:
            'Check whether a Puter app name is available (not already taken) before creating an app with it. ' +
            'Equivalent to PuterJS puter.apps.checkName(name).',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'The candidate app name to check.' },
            },
            required: ['name'],
        },
        async handler(puter, { name }) {
            return puter.apps.checkName(name);
        },
    },

    // ----- puter.js documentation ------------------------------------------
    {
        name: 'puter_docs_index',
        description:
            'Load the index of Puter / puter.js documentation (from docs.puter.com/llms.txt): a list of ' +
            'every topic and its doc path, spanning the whole puter.js SDK — Workers (serverless ' +
            'functions), Hosting, FS, KV, AI (500+ models), Auth, and more. Call this FIRST to discover ' +
            'which doc to read, then fetch the page with puter_docs_get. Puter Workers and the tools in ' +
            'this server are designed to be used WITH puter.js and Puter authentication, so consult ' +
            'these docs before writing any worker or SDK code.',
        inputSchema: { type: 'object', properties: {} },
        async handler() {
            const text = await fetchDocText(DOCS_INDEX_URL);
            return { _meta: { source: DOCS_INDEX_URL }, text };
        },
    },
    {
        name: 'puter_docs_get',
        description:
            'Fetch a specific Puter / puter.js documentation page as Markdown by the topic path listed in ' +
            'puter_docs_index. Examples: "Workers/router" (the Worker router guide + canonical examples — ' +
            'read this before writing a worker), "Workers/create", "AI/chat", "KV/set", "FS/write", ' +
            '"Hosting/create". Use it to read the exact API and copy working examples before writing ' +
            'worker or puter.js code.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Doc topic path from the index, e.g. "Workers/router" or "AI/chat". A trailing "/index.md" is optional. Must be a docs.puter.com topic.',
                },
            },
            required: ['path'],
        },
        async handler(puter, { path }) {
            const url = resolveDocUrl(path);
            const text = await fetchDocText(url);
            return { _meta: { source: url }, text };
        },
    },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** Build the tools/list payload (strips internal handlers). */
export function listTools() {
    return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

/** Pretty-print a value for a text content block. */
export function asText(value) {
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
