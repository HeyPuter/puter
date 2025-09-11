import { createLock, getFileLocks, getLocksIfValid, refreshLock } from '../lockStore.mjs';
import { escapeXml } from '../utils.mjs';

/**
 *
 * @param {string} lockToken
 * @param {string} lockScope
 * @param {string} filePath
 * @returns
 */
const getLockResponse = ( lockToken, lockScope, filePath ) => {
    return `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
    <D:lockdiscovery>
        <D:activelock>
            <D:locktype><D:write/></D:locktype>
            <D:lockscope><D:${lockScope}/></D:lockscope>
            <D:depth>0</D:depth>
            <D:owner>
                <D:href>webdav-user</D:href>
            </D:owner>
            <D:timeout>Second-7200</D:timeout>
            <D:locktoken>
                <D:href>${lockToken}</D:href>
            </D:locktoken>
            <D:lockroot>
                <D:href>/dav${escapeXml(encodeURI(filePath))}</D:href>
            </D:lockroot>
        </D:activelock>
    </D:lockdiscovery>
</D:prop>`;
};
/**
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} filePath
 * @param {import('../../../filesystem/FSNodeContext')} fileNode
 * @param {string} headerLockToken
 * @returns
 */
export const LOCK = async ( req, res, filePath, fileNode, headerLockToken ) => {
    try {
        const servicesForLocks = [req.services.get('su'), req.services.get('puter-kvstore').as('puter-kvstore')];
        const exists = await fileNode.exists();

        const lockScope = req.body.lockinfo?.lockscope?.[0]?.shared ? 'shared' : 'exclusive';
        const lockType = req.body.lockinfo?.locktype?.[0]?.write ? 'write' : null;

        const existingFileFromLock = (await getLocksIfValid(...servicesForLocks, headerLockToken)).pop();

        // Check if the resource exists
        if ( !exists ) {
            // handle non exsiting child folder if lock is present to refresh parent
            if ( existingFileFromLock && filePath.startsWith(existingFileFromLock.path) ) {
                filePath = existingFileFromLock.path;
            }
            // Though technically the resource does not exist, we'll make a lock so that other's can't write to it technically.
        }

        const locksOnFile = await getFileLocks(...servicesForLocks, filePath);
        // handle exclusive locks if theres any lock in place
        if (
            lockScope === 'exclusive' &&
            locksOnFile?.length &&
            ( !headerLockToken || existingFileFromLock?.path !== `${filePath}` )
        ) {
            res.status(423).end( 'Locked: Resource already locked');
            return;
        }
        // handle shared locks
        if (
            locksOnFile?.length &&
            locksOnFile?.find(( lock ) => lock.lockScope === '')
            && (
                !headerLockToken || existingFileFromLock?.path !== `${filePath}`)
        ) {
            res.status(423).end( 'Locked: Resource already locked');
            return;
        }

        // Generate a UUID lock token
        const lockToken = headerLockToken
            ? await refreshLock(...servicesForLocks, headerLockToken, filePath)
            : await createLock(...servicesForLocks, filePath, lockScope, lockType);

        // Set proper headers for WebDAV XML response
        res.set({
            'Content-Type': 'application/xml; charset=utf-8',
            ...( headerLockToken && lockScope !== 'shared' ? {} : { 'Lock-Token': `<${lockToken}>` } ),
            DAV: '1, 2',
            'MS-Author-Via': 'DAV',
        });

        // Return lock response
        const lockResponse = getLockResponse(lockToken, lockScope, filePath);
        res.status(!exists ? 201 : 200);
        res.end(lockResponse);
    } catch( error ) {
        console.error('LOCK error:', error);
        res.status(500).end( 'Internal Server Error');
    }
};
