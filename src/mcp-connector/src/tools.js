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

/**
 * Normalize puter.fs.read output (a Blob/Response-like) into text or base64,
 * optionally returning only the byte window [offset, offset + length).
 */
async function decodeReadResult(result, encoding, offset, length) {
    const wantsWindow = offset != null || length != null;
    let bytes;
    if (result instanceof Blob) {
        bytes = new Uint8Array(await result.arrayBuffer());
    } else if (result instanceof ArrayBuffer) {
        bytes = new Uint8Array(result);
    } else if (result instanceof Uint8Array) {
        bytes = result;
    } else if (typeof result === 'string') {
        if (encoding === 'base64' || wantsWindow) {
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

    const totalBytes = bytes.length;
    if (wantsWindow) {
        const start = Math.min(offset ?? 0, totalBytes);
        bytes = bytes.subarray(start, length != null ? start + length : undefined);
    }

    const window = wantsWindow ? { offset: offset ?? 0, total_bytes: totalBytes } : {};
    if (encoding === 'base64') {
        return { content: bytesToBase64(bytes), encoding: 'base64', bytes: bytes.length, ...window };
    }
    return { content: new TextDecoder().decode(bytes), encoding: 'utf8', bytes: bytes.length, ...window };
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

// ----- signed (out-of-band) uploads ----------------------------------------
// fs_write_file carries every byte inline, so a large file has to be base64'd
// through the caller's context before it ever reaches us. The fs_*_upload tools
// hand back a presigned storage URL instead: the caller PUTs the file straight
// to storage and then finalizes, and the bytes never pass through this server
// or the conversation.

/** POST JSON to a Puter API endpoint as the caller, returning the parsed body. */
async function postApi(puter, endpoint, payload) {
    const resp = await fetch(`${puter.APIOrigin}${endpoint}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${puter.authToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const text = await resp.text();
    let body = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }
    }
    if (!resp.ok) {
        const message = (body && (body.message || body.error?.message || body.error))
            || (typeof body === 'string' && body)
            || `Request failed with status ${resp.status}`;
        const error = new Error(typeof message === 'string' ? message : JSON.stringify(message));
        error.status = resp.status;
        throw error;
    }
    return body;
}

/** Single-quote a string for safe interpolation into the emitted shell command. */
function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** Best-effort content type from a file extension, for the signed PUT. */
const UPLOAD_MIME_BY_EXT = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', html: 'text/html',
    css: 'text/css', js: 'application/javascript', json: 'application/json',
    xml: 'application/xml', pdf: 'application/pdf', zip: 'application/zip',
    gz: 'application/gzip', tar: 'application/x-tar', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', ico: 'image/x-icon', mp3: 'audio/mpeg', wav: 'audio/wav',
    ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

function guessContentType(path) {
    const name = String(path).split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return 'application/octet-stream';
    return UPLOAD_MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] || 'application/octet-stream';
}

/** The directory part of a Puter path ('' when the path has no directory part). */
function parentPath(path) {
    const trimmed = String(path).replace(/\/+$/, '');
    const cut = trimmed.lastIndexOf('/');
    if (cut < 0) return '';
    return cut === 0 ? '/' : trimmed.slice(0, cut);
}

/** Whether `path` exists and is a directory. */
async function isDirectory(puter, path) {
    if (!path) return false;
    try {
        const entry = await puter.fs.stat(path, { returnSize: false });
        return Boolean(entry && entry.is_dir);
    } catch {
        return false;
    }
}

/**
 * Create the directory a move will land in, for fs_move's create_missing_parents.
 * The API's /move requires an existing destination parent, so the directory has
 * to exist before the call.
 *
 * Which directory that is follows the same rule puter.fs.move applies: with an
 * explicit new_name the destination IS the containing directory, and without one
 * an existing directory is moved into while anything else is treated as the
 * item's new full path.
 */
async function ensureMoveDestination(puter, destination, newName) {
    if (newName) {
        if (!await isDirectory(puter, destination)) {
            await puter.fs.mkdir(destination, { createMissingParents: true });
        }
        return;
    }
    if (await isDirectory(puter, destination)) return;
    const parent = parentPath(destination);
    if (parent && !await isDirectory(puter, parent)) {
        await puter.fs.mkdir(parent, { createMissingParents: true });
    }
}

// Every Puter path lives under the user's home directory (/<username>). Agents
// routinely guess bare root paths like "/portfolio/index.html", which do NOT
// exist — this note steers them to valid forms.
// Shared by every kv_* tool. The backend pins app-scoped tokens to their own
// app and ignores the override; only a user token (what this server carries)
// can point a call at another app's store.
const KV_APP_UUID_NOTE =
    'Uid of an app whose store to use instead of your own user-level store ' +
    '(e.g. "app-1234abcd..." from apps_list). Omit for your own store.';

/** Wrap an app uid as the { optConfig } puter.kv methods take, or nothing. */
const kvOptConfig = (appUuid) => (appUuid ? { optConfig: { appUuid } } : {});

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
            'pass encoding="base64" for binary files. Pass offset/length to get back only ' +
            'that byte window — useful for sampling a large file instead of pulling all of ' +
            'it. When a window is returned, _meta reports total_bytes so you can page through ' +
            'the rest. Equivalent to PuterJS puter.fs.read(path).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `File path to read. ${HOME_PATH_NOTE}` },
                encoding: { type: 'string', enum: ['utf8', 'base64'], default: 'utf8' },
                offset: { type: 'integer', minimum: 0, description: 'Byte offset to start from. Defaults to 0.' },
                length: { type: 'integer', minimum: 1, description: 'Number of bytes to return. Defaults to the rest of the file.' },
            },
            required: ['path'],
        },
        async handler(puter, { path, encoding = 'utf8', offset, length }) {
            // The window is applied here rather than passed to puter.fs.read: the SDK
            // sends offset/byte_count as query params and /read only honors a Range
            // header, so a pass-through would silently return the whole file.
            const result = await puter.fs.read(path);
            const decoded = await decodeReadResult(result, encoding, offset, length);
            const { content, encoding: enc, ...meta } = decoded;
            return { _meta: { encoding: enc, ...meta }, text: content };
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
            'Write (create or overwrite) a file in Puter from content you supply inline. Provide content ' +
            'as UTF-8 text, or set encoding="base64" to write binary data. Best for text you are ' +
            'generating anyway; for a file that already exists on disk — especially a large or binary ' +
            'one — use fs_start_upload instead, which moves the bytes out of band. Equivalent to ' +
            'PuterJS puter.fs.write(path, data).',
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
        name: 'fs_start_upload',
        description:
            'Begin an out-of-band file upload and get back a presigned URL to PUT the bytes to. ' +
            'PREFER THIS OVER fs_write_file for any file you already have on disk, and for anything ' +
            'large or binary: the bytes go straight from your machine to storage instead of being ' +
            'base64-encoded through this conversation. Three steps: (1) call this with the destination ' +
            'path and the file\'s exact byte size, (2) run the returned `upload_command` in a shell, ' +
            '(3) call fs_complete_upload with the returned upload_id — the file does not exist in Puter ' +
            'until you do. Get the exact size with `wc -c < file` and pass it verbatim; a wrong size is ' +
            'rejected. The URL expires (see expires_at), so upload promptly. If the upload fails, call ' +
            'fs_abort_upload rather than leaving the session dangling.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `Destination file path in Puter. ${HOME_PATH_NOTE}` },
                size: {
                    type: 'integer',
                    minimum: 0,
                    description: 'Exact size of the file in bytes (`wc -c < file`). Must match what you upload.',
                },
                local_path: {
                    type: 'string',
                    description: 'Path of the local file being uploaded. Only used to write the `upload_command` for you; this server never reads it.',
                },
                content_type: {
                    type: 'string',
                    description: 'MIME type. Defaults to a guess from the destination extension. The upload MUST send this exact value as its Content-Type header — `upload_command` already does.',
                },
                expires_in: {
                    type: 'integer',
                    description: 'Seconds the upload URL stays valid. Clamped to 60..3600 by the server. Defaults to 900.',
                },
                overwrite: { type: 'boolean', default: true, description: 'Overwrite an existing file.' },
                create_missing_parents: {
                    type: 'boolean',
                    default: true,
                    description: 'Create missing parent directories.',
                },
                dedupe_name: {
                    type: 'boolean',
                    default: false,
                    description: 'Auto-rename instead of overwriting if the file exists.',
                },
            },
            required: ['path', 'size'],
        },
        async handler(puter, {
            path, size, local_path, content_type, expires_in,
            overwrite = true, create_missing_parents = true, dedupe_name = false,
        }) {
            const contentType = content_type || guessContentType(path);
            const startResponse = await postApi(puter, '/fs/startBatchWrite', [{
                fileMetadata: {
                    path,
                    size,
                    contentType,
                    overwrite,
                    dedupeName: dedupe_name,
                    createMissingParents: create_missing_parents,
                },
                uploadMode: 'single',
                ...(expires_in ? { expiresInSeconds: expires_in } : {}),
            }]);
            const started = Array.isArray(startResponse) ? startResponse[0] : null;

            if (!started || !started.sessionId) {
                throw new Error(
                    'This Puter server did not return a presigned upload URL. Use fs_write_file instead.',
                );
            }

            // The server upgrades anything past its single-PUT ceiling to a
            // multipart upload, which needs a per-part ETag dance we don't
            // support here. Release the session rather than leaving it pending.
            if (started.uploadMode !== 'single' || !started.url) {
                await postApi(puter, '/fs/abortWrite', { uploadId: started.sessionId }).catch(() => {});
                throw new Error(
                    `File is too large for a single-shot signed upload (${size} bytes). ` +
                    'Split it into smaller files, or use fs_write_file if it is small enough to inline.',
                );
            }

            const target = local_path ? shellQuote(local_path) : '<LOCAL_FILE>';
            return {
                upload_id: started.sessionId,
                url: started.url,
                content_type: started.contentType || contentType,
                size,
                path,
                expires_at: new Date(started.expiresAt).toISOString(),
                upload_command:
                    `curl -sS --fail-with-body -X PUT ` +
                    `-H ${shellQuote(`Content-Type: ${started.contentType || contentType}`)} ` +
                    `--upload-file ${target} ${shellQuote(started.url)}`,
                next_step:
                    'Run upload_command, then call fs_complete_upload with this upload_id. ' +
                    'The file is not visible in Puter until that call succeeds.',
            };
        },
    },
    {
        name: 'fs_complete_upload',
        description:
            'Finalize an upload started with fs_start_upload, after the bytes have been PUT to the ' +
            'presigned URL. This is what actually creates the file in Puter — skip it and the upload ' +
            'is discarded. Returns the created file entry.',
        inputSchema: {
            type: 'object',
            properties: {
                upload_id: { type: 'string', description: 'The upload_id returned by fs_start_upload.' },
            },
            required: ['upload_id'],
        },
        async handler(puter, { upload_id }) {
            const response = await postApi(puter, '/fs/completeBatchWrite', [{ uploadId: upload_id }]);
            const completed = Array.isArray(response) ? response[0] : response;
            return (completed && completed.fsEntry) || completed;
        },
    },
    {
        name: 'fs_abort_upload',
        description:
            'Discard an upload started with fs_start_upload without creating a file. Use this when the ' +
            'PUT failed or you changed your mind, so the pending upload does not linger.',
        inputSchema: {
            type: 'object',
            properties: {
                upload_id: { type: 'string', description: 'The upload_id returned by fs_start_upload.' },
            },
            required: ['upload_id'],
        },
        async handler(puter, { upload_id }) {
            await postApi(puter, '/fs/abortWrite', { uploadId: upload_id });
            return { success: true, aborted: upload_id };
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
    {
        name: 'fs_copy',
        description:
            'Copy a file or directory in Puter to another location. If destination is an existing ' +
            'directory the item is copied into it under the same name; pass new_name to copy it under a ' +
            'different name. On a name conflict the copy is auto-renamed ("file (1).txt") unless you pass ' +
            'overwrite=true. Equivalent to PuterJS puter.fs.copy(source, destination).',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: `Path of the file or directory to copy. ${HOME_PATH_NOTE}` },
                destination: {
                    type: 'string',
                    description: `Destination directory to copy into (or the full destination path when combined with new_name). ${HOME_PATH_NOTE}`,
                },
                new_name: { type: 'string', description: 'Name for the copy at the destination. Defaults to the source name.' },
                overwrite: { type: 'boolean', default: false, description: 'Overwrite an existing item at the destination.' },
                dedupe_name: {
                    type: 'boolean',
                    default: true,
                    description: 'Auto-rename the copy instead of failing when the name is taken.',
                },
            },
            required: ['source', 'destination'],
        },
        async handler(puter, { source, destination, new_name, overwrite = false, dedupe_name = true }) {
            const result = await puter.fs.copy(source, destination, {
                newName: new_name,
                overwrite,
                dedupeName: dedupe_name,
            });
            // puter.fs.copy resolves to the raw API shape ([{ copied: entry }]).
            // Unwrap it so every fs_* tool answers with the same item shape.
            const items = (Array.isArray(result) ? result : [result])
                .map((entry) => (entry && entry.copied) || entry);
            return items.length === 1 ? items[0] : items;
        },
    },
    {
        name: 'fs_move',
        description:
            'Move a file or directory in Puter to another location. If destination is an existing ' +
            'directory the item is moved into it under the same name; otherwise destination is treated as ' +
            "the item's new full path (so this also renames). The destination directory must already " +
            'exist unless you pass create_missing_parents. Equivalent to PuterJS ' +
            'puter.fs.move(source, destination).',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: `Path of the file or directory to move. ${HOME_PATH_NOTE}` },
                destination: {
                    type: 'string',
                    description: `Destination directory to move into, or the item's new full path. ${HOME_PATH_NOTE}`,
                },
                new_name: { type: 'string', description: 'Name for the item at the destination. Defaults to the source name.' },
                overwrite: { type: 'boolean', default: false, description: 'Overwrite an existing item at the destination.' },
                dedupe_name: {
                    type: 'boolean',
                    default: false,
                    description: 'Auto-rename ("file (1).txt") instead of failing when the name is taken.',
                },
                create_missing_parents: {
                    type: 'boolean',
                    default: false,
                    description: 'Create the destination directory (and any missing parents) first. It is left behind if the move itself then fails.',
                },
            },
            required: ['source', 'destination'],
        },
        async handler(puter, {
            source, destination, new_name, overwrite = false, dedupe_name = false, create_missing_parents = false,
        }) {
            if (create_missing_parents) {
                await ensureMoveDestination(puter, destination, new_name);
            }
            const result = await puter.fs.move(source, destination, {
                newName: new_name,
                overwrite,
                dedupeName: dedupe_name,
            });
            // As with fs_copy: unwrap the API's { moved: entry } envelope.
            return (result && result.moved) || result;
        },
    },
    {
        name: 'fs_rename',
        description:
            'Rename a file or directory in Puter in place, keeping it in the same parent directory. To ' +
            'move an item to a different directory use fs_move instead. Equivalent to PuterJS ' +
            'puter.fs.rename(path, new_name).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: `Path of the file or directory to rename. ${HOME_PATH_NOTE}` },
                new_name: { type: 'string', description: 'The new name (a bare name, not a path).' },
            },
            required: ['path', 'new_name'],
        },
        async handler(puter, { path, new_name }) {
            return puter.fs.rename(path, new_name);
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

    // ----- key-value store (puter.kv) --------------------------------------
    // Puter's KV store is namespaced per app within each user's account. This
    // server authenticates with a user token, so by default every tool here
    // reads and writes the user's own namespace; app_uuid retargets a single
    // call at one app's store (for example the sandbox-<worker> app a deployed
    // worker runs as, which is where that worker's own puter.kv data lives).
    //
    // Values are stored as JSON, so anything a JSON-RPC argument can express
    // round-trips: strings, numbers, booleans, null, objects, arrays. Several
    // tools address into a stored object by "dot path" — "profile.bio" means
    // the `bio` field of the stored object's `profile` field — with the empty
    // path "" meaning the value itself.
    {
        name: 'kv_get',
        description:
            "Read a key from the authenticated user's Puter key-value store. Returns { key, value }, " +
            'where value is null when the key is not in the store — a stored null reads the same way, ' +
            'so use kv_list when you need to tell those apart. Equivalent to PuterJS puter.kv.get(key).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to read (max 1 KB).' },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key'],
        },
        async handler(puter, { key, app_uuid }) {
            const value = await puter.kv.get({ key, ...kvOptConfig(app_uuid) });
            // Wrapped in an object because a bare `undefined`/null has no text
            // form to hand back as tool output.
            return { key, value: value === undefined ? null : value };
        },
    },
    {
        name: 'kv_set',
        description:
            'Create or overwrite a key in the Puter key-value store. The value is stored as JSON ' +
            '(string, number, boolean, null, object, or array; max 400 KB). Pass expire_at to have ' +
            'the key removed at a given time. Equivalent to PuterJS puter.kv.set(key, value).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to write (max 1 KB).' },
                value: { description: 'Value to store, as any JSON value (max 400 KB).' },
                expire_at: {
                    type: 'integer',
                    description: 'Unix timestamp in seconds at which the key expires. Omit to keep it indefinitely.',
                },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key', 'value'],
        },
        async handler(puter, { key, value, expire_at, app_uuid }) {
            return puter.kv.set({
                key,
                value,
                ...(expire_at != null ? { expireAt: expire_at } : {}),
                ...kvOptConfig(app_uuid),
            });
        },
    },
    {
        name: 'kv_del',
        description:
            'Delete a key from the Puter key-value store. Succeeds whether or not the key existed. ' +
            'Equivalent to PuterJS puter.kv.del(key).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to delete.' },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key'],
        },
        async handler(puter, { key, app_uuid }) {
            const ok = await puter.kv.del({ key, ...kvOptConfig(app_uuid) });
            return { success: ok !== false, deleted: key };
        },
    },
    {
        name: 'kv_list',
        description:
            'List keys in the Puter key-value store, sorted by key. Returns keys only unless ' +
            'return_values is true. Every page is metered and a full listing reads the whole store, ' +
            'so narrow it with pattern and/or limit rather than listing everything. Equivalent to ' +
            'PuterJS puter.kv.list(options).',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Prefix filter with an optional trailing "*" ("user:" and "user:*" both match keys starting with "user:"). Defaults to all keys.',
                },
                return_values: {
                    type: 'boolean',
                    default: false,
                    description: 'Return { key, value } pairs instead of bare key names.',
                },
                limit: { type: 'integer', minimum: 1, description: 'Maximum number of items in this page. Returns a page object with a cursor for the rest.' },
                cursor: { type: 'string', description: 'Cursor from a previous page.' },
                offset: {
                    type: 'integer',
                    minimum: 0,
                    description: 'Skip this many items before the page (max 5000; cannot be combined with cursor). Prefer cursor — large offsets get slower and more expensive.',
                },
                include_total: { type: 'boolean', default: false, description: 'Include a total count of matching items in the page.' },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
        },
        async handler(puter, { pattern, return_values = false, limit, cursor, offset, include_total, app_uuid }) {
            return puter.kv.list({
                ...(pattern != null ? { pattern } : {}),
                returnValues: return_values,
                ...(limit != null ? { limit } : {}),
                ...(cursor != null ? { cursor } : {}),
                ...(offset != null ? { offset } : {}),
                ...(include_total != null ? { includeTotal: include_total } : {}),
                ...kvOptConfig(app_uuid),
            });
        },
    },
    {
        name: 'kv_incr',
        description:
            'Increment a numeric value in the Puter key-value store and return the new value. A key ' +
            'that does not exist starts at 0. Pass a number to increment the value itself, or an ' +
            'object mapping dot paths to amounts to bump fields inside a stored object. Equivalent ' +
            'to PuterJS puter.kv.incr(key, amount).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to increment.' },
                amount: {
                    description: 'Number to add (default 1), or an object like { "stats.views": 2 } mapping dot paths to amounts.',
                    anyOf: [{ type: 'number' }, { type: 'object', additionalProperties: { type: 'number' } }],
                },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key'],
        },
        async handler(puter, { key, amount, app_uuid }) {
            return puter.kv.incr(key, amount, kvOptConfig(app_uuid).optConfig);
        },
    },
    {
        name: 'kv_decr',
        description:
            'Decrement a numeric value in the Puter key-value store and return the new value. A key ' +
            'that does not exist starts at 0. Pass a number to decrement the value itself, or an ' +
            'object mapping dot paths to amounts. Equivalent to PuterJS puter.kv.decr(key, amount).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to decrement.' },
                amount: {
                    description: 'Number to subtract (default 1), or an object like { "stats.views": 2 } mapping dot paths to amounts.',
                    anyOf: [{ type: 'number' }, { type: 'object', additionalProperties: { type: 'number' } }],
                },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key'],
        },
        async handler(puter, { key, amount, app_uuid }) {
            return puter.kv.decr(key, amount, kvOptConfig(app_uuid).optConfig);
        },
    },
    {
        name: 'kv_add',
        description:
            'Add to the value already stored at a key and return the updated value — numbers are ' +
            'summed and arrays are appended to. Pass a plain value to add to the value itself, or an ' +
            'object mapping dot paths to the values to add at each path. To add an object as a value ' +
            'rather than as a path map, use kv_update. Equivalent to PuterJS puter.kv.add(key, value).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to add to.' },
                value: { description: 'Value to add (default 1). An object is read as a { "dot.path": value } map.' },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key'],
        },
        async handler(puter, { key, value, app_uuid }) {
            return puter.kv.add(key, value, kvOptConfig(app_uuid).optConfig);
        },
    },
    {
        name: 'kv_update',
        description:
            'Update fields inside the object stored at a key without overwriting the whole value, ' +
            'returning the updated value. Equivalent to PuterJS puter.kv.update(key, pathAndValueMap).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to update.' },
                values: {
                    type: 'object',
                    description: 'Maps dot paths to their new values, e.g. { "profile.bio": "hi", "seen": 3 }. The path "" replaces the whole value.',
                    additionalProperties: true,
                },
                ttl: { type: 'integer', minimum: 1, description: 'Optional time-to-live for the key, in seconds.' },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key', 'values'],
        },
        async handler(puter, { key, values, ttl, app_uuid }) {
            return puter.kv.update({
                key,
                pathAndValueMap: values,
                ...(ttl != null ? { ttl } : {}),
                ...kvOptConfig(app_uuid),
            });
        },
    },
    {
        name: 'kv_remove',
        description:
            'Remove one or more fields from the object stored at a key by dot path, returning the ' +
            'updated value. To delete the key itself use kv_del. Equivalent to PuterJS ' +
            'puter.kv.remove(key, ...paths).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to remove fields from.' },
                paths: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    description: 'Dot paths to remove, e.g. ["profile.bio", "seen"].',
                },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key', 'paths'],
        },
        async handler(puter, { key, paths, app_uuid }) {
            const optConfig = kvOptConfig(app_uuid).optConfig;
            // remove() takes the paths as separate arguments, with optConfig
            // trailing — passing it as undefined would be read as a path.
            const args = optConfig ? [...paths, optConfig] : paths;
            return puter.kv.remove(key, ...args);
        },
    },
    {
        name: 'kv_expire',
        description:
            'Set how long a key lives, in seconds from now, after which it is removed. Equivalent to ' +
            'PuterJS puter.kv.expire(key, ttlSeconds).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to expire.' },
                ttl_seconds: { type: 'integer', minimum: 1, description: 'Seconds from now until the key is removed.' },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key', 'ttl_seconds'],
        },
        async handler(puter, { key, ttl_seconds, app_uuid }) {
            return puter.kv.expire(key, ttl_seconds, kvOptConfig(app_uuid).optConfig);
        },
    },
    {
        name: 'kv_expire_at',
        description:
            'Set the exact time a key is removed, as a Unix timestamp in seconds. Equivalent to ' +
            'PuterJS puter.kv.expireAt(key, timestampSeconds).',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Key to expire.' },
                timestamp_seconds: { type: 'integer', description: 'Unix timestamp in seconds at which the key is removed.' },
                app_uuid: { type: 'string', description: KV_APP_UUID_NOTE },
            },
            required: ['key', 'timestamp_seconds'],
        },
        async handler(puter, { key, timestamp_seconds, app_uuid }) {
            return puter.kv.expireAt(key, timestamp_seconds, kvOptConfig(app_uuid).optConfig);
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
