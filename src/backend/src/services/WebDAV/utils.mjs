import { HLCopy } from '../../filesystem/hl_operations/hl_copy.js';
import { HLMkdir } from '../../filesystem/hl_operations/hl_mkdir.js';
import { HLMove } from '../../filesystem/hl_operations/hl_move.js';
import { HLReadDir } from '../../filesystem/hl_operations/hl_readdir.js';
import { HLRemove } from '../../filesystem/hl_operations/hl_remove.js';
import { HLStat } from '../../filesystem/hl_operations/hl_stat.js';
import { HLWrite } from '../../filesystem/hl_operations/hl_write.js';
import { LLRead } from '../../filesystem/ll_operations/ll_read.js';
import { Context } from '../../util/context.js';

/**
 * Small utility function to escape XML
 *
 * @param {string} text
 * @returns
 */
export const escapeXml = ( text ) => {
    if ( typeof text !== 'string' ) return text;
    return text
        .replace(/&/g, '&amp;')
        .replace( /</g, '&lt;')
        .replace( />/g, '&gt;')
        .replace( /"/g, '&quot;')
        .replace( /'/g, '&#39;');
};

// Small operations wrapper to make my life a bit easier. Generally it takes a FileNode and returns what puter.fs in puter.js would return.
export const fsOperations = {
    stat: ( node ) => {
        const hl_stat = new HLStat();
        return hl_stat.run({
            subject: node,
            user: Context.get('actor'),
            return_subdomains: true,
            return_permissions: true,
            return_shares: false,
            return_versions: false,
            return_size: true,
        });
    },
    readdir: ( node ) => {
        const hl_readdir = new HLReadDir();
        return hl_readdir.run({
            subject: node,
            // user: Context.get("actor").type.user,
            actor: Context.get('actor'),
            recursive: false,
            no_thumbs: false,
            no_assocs: false,
        });
    },
    read: ( node, options ) => {
        const ll_read = new LLRead();
        return ll_read.run({
            fsNode: node,
            actor: Context.get('actor'),
            ...options,
        });
    },
    write: ( node, options ) => {
        const hl_write = new HLWrite();
        return hl_write.run({
            destination_or_parent: node,
            actor: Context.get('actor'),
            file: {
                stream: options.stream,
                size: options.size || 0,
                ...options.file, // Allow additional file properties
            },
            overwrite: options.overwrite !== undefined ? options.overwrite : true, // Default to true for WebDAV PUT
            create_missing_parents: false,
            dedupe_name: false,
            user: Context.get('actor').type.user,
            specified_name: options.name, // Optional filename if node is a directory
            fallback_name: options.fallback_name,
            shortcut_to: options.shortcut_to,
            no_thumbnail: options.no_thumbnail || true, // Disable thumbnails for WebDAV by default
            message: options.message,
            app_id: options.app_id,
            socket_id: options.socket_id,
            operation_id: options.operation_id,
            item_upload_id: options.item_upload_id,
            offset: options.offset, // For partial/resume uploads
        });
    },
    mkdir: ( node, options ) => {
        const hl_mkdir = new HLMkdir();
        return hl_mkdir.run({
            parent: node,
            path: options.path || options.name, // Support both path and name parameters
            actor: Context.get('actor'),
            overwrite: options.overwrite || false, // WebDAV MKCOL should not overwrite by default
            create_missing_parents:
        options.create_missing_parents !== undefined ? options.create_missing_parents : true, // Auto-create parent directories
            shortcut_to: options.shortcut_to, // Support for shortcuts
            user: Context.get('actor').type.user, // User context for permissions
        });
    },
    delete: ( node ) => {
        const hl_remove = new HLRemove();
        return hl_remove.run({
            target: node,
            recursive: true,
            user: Context.get('actor'),
        });
    },
    move: ( sourceNode, options ) => {
        const hl_move = new HLMove();
        return hl_move.run({
            source: sourceNode, // The source fileNode being moved
            destination_or_parent: options.destinationNode, // The destination fileNode (could be parent dir or exact destination)
            user: Context.get('actor').type.user,
            actor: Context.get('actor'),
            new_name: options.new_name, // New name in the destination folder
            overwrite: options.overwrite !== undefined ? options.overwrite : false, // WebDAV overwrite is optional
            dedupe_name: options.dedupe_name || false, // Handle name conflicts
            create_missing_parents: options.create_missing_parents || false, // Whether to create missing parent directories
            new_metadata: options.new_metadata, // Optional metadata updates
        });
    },
    copy: ( sourceNode, options ) => {
        const hl_copy = new HLCopy();
        return hl_copy.run({
            source: sourceNode, // The source fileNode being copied
            destination_or_parent: options.destinationNode, // The destination fileNode (could be parent dir or exact destination)
            user: Context.get('actor').type.user,
            new_name: options.new_name, // New name in the destination folder
            overwrite: options.overwrite !== undefined ? options.overwrite : false, // WebDAV overwrite is optional
            dedupe_name: options.dedupe_name || false, // Handle name conflicts
        });
    },
};

export const getProperMimeType = ( originalType, filename ) => {
    // If we have a type and it's not the generic octet-stream, use it
    if ( originalType && originalType !== 'application/octet-stream' ) {
        return originalType;
    }

    // Otherwise, guess based on file extension
    const ext = filename.split('.').pop()?.toLowerCase();
    switch ( ext ) {
    case 'js':
        return 'application/javascript';
    case 'css':
        return 'text/css';
    case 'html':
    case 'htm':
        return 'text/html';
    case 'txt':
        return 'text/plain';
    case 'json':
        return 'application/json';
    case 'xml':
        return 'application/xml';
    case 'pdf':
        return 'application/pdf';
    case 'png':
        return 'image/png';
    case 'jpg':
    case 'jpeg':
        return 'image/jpeg';
    case 'gif':
        return 'image/gif';
    case 'svg':
        return 'image/svg+xml';
    default:
        return 'application/octet-stream';
    }
};