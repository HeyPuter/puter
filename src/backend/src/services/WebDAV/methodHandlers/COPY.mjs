import path from 'path';
import { NodePathSelector } from '../../../filesystem/node/selectors.js';
import { hasWritePermissionInDAV } from '../lockStore.mjs';
import { fsOperations } from '../utils.mjs';

/**
 * @type {import('./method.mjs').HandlerFunction}
 */
export const COPY = async ( req, res, _filePath, fileNode, headerLockToken ) => {
    try {
        const servicesForLocks = [req.services.get('su'), req.services.get('puter-kvstore').as('puter-kvstore')];

        const svc_fs = req.services.get('filesystem');
        const exists = await fileNode?.exists();
        // Check if the resource exists
        if ( ! exists ) {
            res.status(404).end( 'Not Found');
            return;
        }

        // Parse Destination header (required for COPY)
        const destinationHeader = req.headers.destination;
        if ( ! destinationHeader ) {
            res.status(400).end( 'Bad Request: Destination header required');
            return;
        }

        // Parse destination URI - extract path after /dav
        let destinationPath;
        try {
            const destUrl = new URL(destinationHeader, `http://${req.headers.host}`);
            if ( ! destUrl.pathname.startsWith('/dav/') ) {
                res.status(400).end( 'Bad Request: Destination must be within WebDAV namespace');
                return;
            }
            destinationPath = destUrl.pathname.substring(4); // Remove '/dav' prefix
            if ( ! destinationPath.startsWith('/') ) {
                destinationPath = `/${destinationPath}`;
            }
        } catch ( _e ) {
            res.status(400).end( 'Bad Request: Invalid destination URI');
            return;
        }
        destinationPath = decodeURI(destinationPath);

        // Parse Overwrite header (T = true, F = false, default = T)
        const overwriteHeader = req.headers.overwrite;
        const overwrite = overwriteHeader !== 'F'; // Default to true unless explicitly F

        // Parse destination path to get parent and new name
        const destParentPath = path.dirname(destinationPath);
        const destName = path.basename(destinationPath);

        // Check if destination already exists
        const destNode = await svc_fs.node(new NodePathSelector(destinationPath));
        const destExists = await destNode.exists();

        if ( destExists && !overwrite ) {
            res.status(412).end( 'Precondition Failed: Destination exists and Overwrite is F');
            return;
        }

        // Get destination parent node
        const destParentNode = await svc_fs.node(new NodePathSelector(destParentPath));
        const destParentExists = await destParentNode.exists();

        if ( ! destParentExists ) {
            res.status(409).end( 'Conflict: Destination parent does not exist');
            return;
        }

        // Verify destination parent is a directory
        const destParentStat = await fsOperations.stat(destParentNode);
        if ( ! destParentStat.is_dir ) {
            res.status(409).end( 'Conflict: Destination parent is not a directory');
            return;
        }

        // check lock
        const hasDestinationWriteAccess = await hasWritePermissionInDAV(...servicesForLocks, destinationPath, headerLockToken);
        if ( ! hasDestinationWriteAccess ) {
            // DAV lock in place blocking write to this file
            res.status(423).end( 'Locked: No write access to destination');
        }

        // Perform the copy operation
        await fsOperations.copy(fileNode, {
            destinationNode: destParentNode,
            new_name: destName,
            overwrite: overwrite,
            dedupe_name: false, // WebDAV should not auto-dedupe
        });

        // Set response headers
        if ( destExists ) {
            res.status(204).end(); // 204 No Content for overwrite
        } else {
            res.status(201).end(); // 201 Created for new resource
        }
    } catch ( error ) {
    // Handle specific error types
        if ( error.code === 'permission_denied' ) {
            res.status(403).end( 'Forbidden');
        } else if ( error.code === 'item_with_same_name_exists' ) {
            res.status(412).end( 'Precondition Failed: Destination exists');
        } else if ( error.code === 'immutable' ) {
            res.status(403).end( 'Forbidden: Resource is immutable');
        } else if ( error.code === 'dest_does_not_exist' ) {
            res.status(409).end( 'Conflict: Destination parent does not exist');
        } else {
            console.error('LOCK error:', error);
            res.status(500).end( 'Internal Server Error');
        }
    }
};
