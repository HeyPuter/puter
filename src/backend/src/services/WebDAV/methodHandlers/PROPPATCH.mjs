// WebDAV PROPPATCH handler for Puter
import { hasWritePermissionInDAV } from '../lockStore.mjs';
import { escapeXml } from '../utils.mjs';

const getStubResponse = ( filePath ) => `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav${escapeXml(encodeURI(filePath))}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

/**
 * Handles the WebDAV PROPPATCH method.
 * Always returns a generic success response (no extended attributes supported) unless locked, which fails but doesn't matter anyway.
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {string} filePath - Path to the target file
 * @param {object} fileNode - File node object (unused in stub)
 * @param {string} headerLockToken - Lock token from headers (unused in stub)
 */
export const PROPPATCH = async ( req, res, filePath, _fileNode, headerLockToken ) => {

    try {
        const servicesForLocks = [req.services.get('su'), req.services.get('puter-kvstore').as('puter-kvstore')];
        const hasDestinationWriteAccess = await hasWritePermissionInDAV(...servicesForLocks, filePath, headerLockToken);

        if ( !hasDestinationWriteAccess ) {
            // DAV lock in place blocking write to this file
            res.status(423).end( 'Locked: No write access to destination');
            return;
        }
        res.set({
            'Content-Type': 'application/xml; charset=utf-8',
            DAV: '1, 2',
            'MS-Author-Via': 'DAV',
        });
        // Generic success response (no real property update)
        const stubResponse = getStubResponse(filePath);

        res.status(207);
        res.end(stubResponse);
    } catch( error ) {
    // Log error to console (can be replaced with service logger if needed)
        console.error('PROPPATCH error:', error);
        res.status(500).end( 'Internal Server Error');
    }
};
