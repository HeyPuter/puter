import { deleteLock, extractHeaderToken, getLocksIfValid } from '../lockStore.mjs';

/**
 * @type {import('./method.mjs').HandlerFunction}
 */
export const UNLOCK = async ( req, res, filePath, fileNode ) => {
    try {
        const servicesForLocks = [req.services.get('su'), req.services.get('puter-kvstore').as('puter-kvstore')];
        const exists = await fileNode?.exists();
        // Check if the resource exists
        if ( !exists ) {
            res.status(204).end();
            return;
        }

        // Check for Lock-Token header (normally required for UNLOCK)
        const lockTokenHeader = req.headers['lock-token'];
        const { headerLockToken } = extractHeaderToken(lockTokenHeader);

        if ( !headerLockToken ) {
            res.status(400).end( 'Bad Request: Lock-Token header required');
            return;
        }

        const existingFileFromLock = (await getLocksIfValid(...servicesForLocks, headerLockToken)).pop();
        if ( existingFileFromLock ) {
            if ( existingFileFromLock.path === filePath ) {
                deleteLock(...servicesForLocks, headerLockToken, filePath);
                return res.status(204).end(); // 204 No Content for successful unlock
            }
            return res.status(403).end(); // 403 Forbidden - lock token does not match
        } else {
            return res.status(409).end(); // 409 Conflict - no lock present
        }
    } catch( error ) {
        console.error('UNLOCK error:', error);
        res.status(500).end( 'Internal Server Error');
    }
};
