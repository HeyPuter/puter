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

export const TOOLS = [
    // ----- filesystem ------------------------------------------------------
    {
        name: 'fs_read_file',
        description:
            'Read the contents of a file in Puter. Returns UTF-8 text by default; ' +
            'pass encoding="base64" for binary files. Supports optional byte offset/length.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path. Absolute (/user/...), ~/relative, or relative to home.' },
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
        description: 'Get metadata (name, size, type, timestamps, uid) for a file or directory in Puter.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Path to a file or directory.' },
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
            'or set encoding="base64" to write binary data.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Destination file path.' },
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
        description: 'Create a directory in Puter (optionally creating missing parents).',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path to create.' },
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
        description: 'Delete a file or directory in Puter. Directories are removed recursively by default.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    description: 'Path (string) or list of paths to delete.',
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
        description: 'List the entries (files and subdirectories) of a directory in Puter.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Directory path to list.' },
            },
            required: ['path'],
        },
        async handler(puter, { path }) {
            return puter.fs.readdir(path);
        },
    },

    // ----- subdomains (puter.hosting) --------------------------------------
    {
        name: 'subdomains_list',
        description: 'List all subdomains owned by the authenticated Puter user.',
        inputSchema: { type: 'object', properties: {} },
        async handler(puter) {
            return puter.hosting.list();
        },
    },
    {
        name: 'subdomains_get',
        description: 'Get a single subdomain (and its root directory) by name.',
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'The subdomain label, e.g. "my-site".' },
            },
            required: ['subdomain'],
        },
        async handler(puter, { subdomain }) {
            return puter.hosting.get(subdomain);
        },
    },
    {
        name: 'subdomains_create',
        description:
            'Create a new subdomain. Optionally point it at a Puter directory (root_dir) to host a static site.',
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: {
                    type: 'string',
                    description: 'Subdomain label (lowercase letters, digits, hyphens; max 64 chars).',
                },
                root_dir: {
                    type: 'string',
                    description: 'Optional Puter directory path the subdomain serves from.',
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
        name: 'subdomains_update',
        description: "Update an existing subdomain's root directory.",
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'The subdomain label to update.' },
                root_dir: {
                    type: 'string',
                    description: 'New Puter directory path to serve from.',
                },
            },
            required: ['subdomain', 'root_dir'],
        },
        async handler(puter, { subdomain, root_dir }) {
            return puter.hosting.update(subdomain, root_dir);
        },
    },
    {
        name: 'subdomains_delete',
        description: 'Delete a subdomain by name.',
        inputSchema: {
            type: 'object',
            properties: {
                subdomain: { type: 'string', description: 'The subdomain label to delete.' },
            },
            required: ['subdomain'],
        },
        async handler(puter, { subdomain }) {
            return puter.hosting.delete(subdomain);
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
