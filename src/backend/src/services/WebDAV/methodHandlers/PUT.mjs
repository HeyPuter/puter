import path from 'path';
import { hasWritePermissionInDAV } from '../lockStore.mjs';
import { fsOperations } from '../utils.mjs';

/**
 * @type {import('./method.mjs').HandlerFunction}
 */
export const PUT = async ( req, res, filePath, fileNode, headerLockToken ) => {
    try {
        const servicesForLocks = [req.services.get('su'), req.services.get('puter-kvstore').as('puter-kvstore')];
        const hasDestinationWriteAccess = await hasWritePermissionInDAV(...servicesForLocks, filePath, headerLockToken);
        if ( ! hasDestinationWriteAccess ) {
            // DAV lock in place blocking write to this file
            res.status(423).end('Locked: No write access to destination');
            return;
        }
        // macOS loves polluting webdav directories with metadata which would be stored regularly in HFS+ or APFS.
        // We will 422 all of these, because no one actually wants to see them.
        const fileName = path.basename(filePath);
        if (
            ( req.headers['user-agent'] &&
                req.headers['user-agent'].includes('Darwin/') &&
                fileName.toLowerCase() === '.ds_store' ) ||
                fileName.startsWith('._')
        ) {
            res.writeHead(422, {
                'Content-Type': 'application/xml; charset=utf-8',
            });

            res.end(`<?xml version="1.0" encoding="utf-8" ?>
<d:error xmlns:d="DAV:">
    <d:valid-resourcename>macOS metadata files not permitted</d:valid-resourcename>
</d:error>`);
            return;
        }

        // Handle Expect: 100-continue header
        if ( req.headers.expect && req.headers.expect.toLowerCase() === '100-continue' ) {
            res.writeContinue();
        }

        // Check Content-Length header to find length
        // TODO: Allow partial uploads with Range header
        // TODO: Allow uploads with no Content-Length
        const contentLength = req.headers['content-length'] || req.headers['x-expected-entity-length']; // x-expected-entity-length is used by macOS Finder for some reason
        if ( ! contentLength ) {
            res.status(400).end( 'Content-Length header required');
            return;
        }

        const fileSize = parseInt(contentLength);
        if ( isNaN(fileSize) || fileSize < 0 ) {
            res.status(400).end( 'Invalid Content-Length');
            return;
        }

        // Check if file exists before writing (for proper status code)
        const existedBefore = await fileNode.exists();

        // Set Content-Type if provided
        const contentType = req.headers['content-type'];

        // Prepare write options
        const writeOptions = {
            stream: req, // Express request object is a readable stream
            size: fileSize,
            overwrite: true, // PUT should always overwrite
            create_missing_parents: true, // Create directories as needed
            no_thumbnail: true, // Disable thumbnails for WebDAV
        };

        // If Content-Type is provided, include it in file metadata
        if ( contentType ) {
            writeOptions.file = {
                mimetype: contentType,
            };
        }

        // Write the file
        const result = await fsOperations.write(fileNode, writeOptions);

        // Set response headers
        res.set({
            ETag: `"${result.uid}-${Math.floor(result.modified)}"`,
            'Last-Modified': new Date(result.modified * 1000).toUTCString(),
        });

        // Return appropriate status code
        if ( existedBefore ) {
            res.status(204).end(); // 204 No Content for updated file
        } else {
            res.status(201).end(); // 201 Created for new file
        }
    } catch ( error ) {
    // Handle specific error types
        if ( error.code === 'item_with_same_name_exists' ) {
            res.status(409).end( 'Conflict: Item already exists');
        } else if ( error.code === 'storage_limit_reached' ) {
            res.status(507).end( 'Insufficient Storage');
        } else if ( error.code === 'permission_denied' ) {
            res.status(403).end( 'Forbidden');
        } else if ( error.code === 'file_too_large' ) {
            res.status(413).end( 'Request Entity Too Large');
        } else {
            console.error('PUT error:', error);
            res.status(500).end( 'Internal Server Error');
        }
    }
};
