import { hasWritePermissionInDAV } from '../lockStore.mjs';
import { fsOperations } from '../utils.mjs';

/**
 * Handler for the DELETE HTTP method in WebDAV.
 * @type {import('./method.mjs').HandlerFunction}
 */
export const DELETE = async ( req, res, filePath, fileNode, headerLockToken ) => {
    try {
        const servicesForLocks = [req.services.get('su'), req.services.get('puter-kvstore').as('puter-kvstore')];

        const hasDestinationWriteAccess = await hasWritePermissionInDAV(...servicesForLocks, filePath, headerLockToken);
        const exists = await fileNode?.exists();
        // Check if the resource exists
        if ( !exists ) {
            res.status(404).end('Not Found');
            return;
        }

        if ( !hasDestinationWriteAccess ){
            // DAV lock in place blocking write to this file
            res.status(423).end('Locked: No write access to destination');
            return;
        }
        // Delete the resource using operations.delete
        await fsOperations.delete(fileNode);

        // Return success response
        res.status(204).end(); // 204 No Content for successful deletion
    } catch( error ) {
    // Handle specific error types
        if ( error.code === 'permission_denied' ) {
            res.status(403).end( 'Forbidden');
        } else if ( error.code === 'immutable' ) {
            res.status(403).end( 'Forbidden');
        } else if ( error.code === 'dir_not_empty' ) {
            res.status(409).end( 'Conflict');
        } else {
            console.error('LOCK error:', error);
            res.status(500).end( 'Internal Server Error');
        }
    }
};
