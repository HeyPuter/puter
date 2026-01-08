import path from 'path';
import { NodePathSelector } from '../../../filesystem/node/selectors.js';
import { hasWritePermissionInDAV } from '../lockStore.mjs';
import { fsOperations } from '../utils.mjs';

/**
 * @type {import('./method.mjs').HandlerFunction}
 */
export const MKCOL = async ( req, res, filePath, fileNode, headerLockToken ) => {
    try {
        const servicesForLocks = [req.services.get('su'), req.services.get('puter-kvstore').as('puter-kvstore')];
        const hasDestinationWriteAccess = await hasWritePermissionInDAV(...servicesForLocks, filePath, headerLockToken);
        const exists = await fileNode?.exists();
        // Check if request has a body (not allowed for MKCOL)
        const contentLength = req.headers['content-length'];
        if ( contentLength && parseInt(contentLength) > 0 ) {
            res.status(415).end( 'Unsupported Media Type');
            return;
        }

        // Parse the path to get parent directory and target name
        const targetPath = filePath;
        const parentPath = path.dirname(targetPath);
        const targetName = path.basename(targetPath);

        // Handle root directory case
        if ( parentPath === '.' || targetPath === '/' ) {
            res.status(403).end( 'Forbidden');
            return;
        }

        // Check if target already exists
        if ( exists ) {
            res.status(405).end( 'Method Not Allowed');
            return;
        }

        if ( ! hasDestinationWriteAccess ) {
            // DAV lock in place blocking write to this file
            res.status(423).end( 'Locked: No write access to destination');
            return;
        }

        // Get parent directory node
        const svc_fs = fileNode.services.get('filesystem');
        const parentNode = await svc_fs.node(new NodePathSelector(parentPath));
        const parentExists = await parentNode.exists();

        if ( ! parentExists ) {
            res.status(409).end( 'Conflict');
            return;
        }

        // Verify parent is a directory
        const parentStat = await fsOperations.stat(parentNode);
        if ( ! parentStat.is_dir ) {
            res.status(409).end( 'Conflict');
            return;
        }

        // Create the directory
        await fsOperations.mkdir(parentNode, {
            name: targetName,
            overwrite: false,
            create_missing_parents: false,
        });

        // Set response headers
        res.set({
            Location: `/dav${targetPath}${targetPath.endsWith('/') ? '' : '/'}`,
            'Content-Length': '0',
        });

        res.status(201).end(); // 201 Created
    } catch ( error ) {
    // Handle specific error types
        if ( error.code === 'item_with_same_name_exists' ) {
            res.status(405).end( 'Method Not Allowed');
        } else if ( error.code === 'permission_denied' ) {
            res.status(403).end( 'Forbidden');
        } else if ( error.code === 'dest_does_not_exist' ) {
            res.status(409).end( 'Conflict');
        } else if ( error.code === 'invalid_file_name' ) {
            res.status(400).end( 'Bad Request');
        } else {
            console.error('MKCOL error:', error);
            res.status(500).end( 'Internal Server Error');
        }
    }
};
