export const DAV_LOCK_DURATION = 30; // seconds

/*
 * @param {string} headerToken
 * @returns
 */
export const extractHeaderToken = (headerToken = '') => {
    let headerLockToken = null;
    let prefix = null;
    const match = headerToken.match(/(.*)<(urn:uuid:[0-9a-fA-F-]{36})>/);
    if ( match ) {
        if ( match.length > 2 ) {
            headerLockToken = match[2];
            prefix = match[1].trim().slice( 1, -1); // Remove surrounding parentheses
        } else {
            headerLockToken = match[1];
        }
    }
    return { headerLockToken, prefix };
};

const LOCK_PREFIX = 'locktoken:';
/**
 * @param {{sudo:Function}} suService
 * @param {import('../../modules/kvstore/KVStoreInterfaceService.js').KVStoreInterface} kvStoreService
 * @param {...string} lockTokens
 * @returns {Promise<{path: string, lockScope: 'shared' | 'exclusive', lockType?: string}[]>}
 */
export const getLocksIfValid = (suService, kvStoreService, ...lockTokens) => {
    return suService.sudo(async () => {
        const res = (await kvStoreService.get({
            key: lockTokens.map(lockToken => `${LOCK_PREFIX}${lockToken}`),
        })).filter(Boolean);
        return res;
    });
};

/**
 * @param {{sudo:Function}} suService
 * @param {import('../../modules/kvstore/KVStoreInterfaceService.js').KVStoreInterface} kvStoreService
 * @param {string} filePath
 * @param {string} lockScope
 * @param {string} lockType
 * @returns {Promise<string>}
 */
export const createLock = ( suService, kvStoreService, filePath, lockScope, lockType ) => {
    return  suService.sudo(async () => {
        const lockToken = `urn:uuid:${crypto.randomUUID()}`;
        const currentTokens = await getFileLocks(suService, kvStoreService, filePath);
        kvStoreService.set({
            key: `${LOCK_PREFIX}${lockToken}`,
            value: { path: filePath, lockScope, lockType },
            expireAt: (Date.now() / 1000) + DAV_LOCK_DURATION,
        });
        kvStoreService.set({
            key: `${LOCK_PREFIX}${filePath}`,
            value: { ...currentTokens, [lockToken]: { lockScope, lockType } },
            expireAt: (Date.now() / 1000) + DAV_LOCK_DURATION,
        });
        return lockToken;
    });
};

/**
 * @param {{sudo:Function}} suService
 * @param {import('../../modules/kvstore/KVStoreInterfaceService.js').KVStoreInterface} kvStoreService
 * @param {string} lockToken
 * @param {string} filePath
 * @returns {void}
 */
export const deleteLock = ( suService, kvStoreService, lockToken, filePath ) => {
    return  suService.sudo(async () => {
        kvStoreService.del({ key: `${LOCK_PREFIX}${lockToken}` });
        kvStoreService.del({ key: `${LOCK_PREFIX}${filePath}` });
    });
};
/**
 * @param {{sudo:Function}} suService
 * @param {import('../../modules/kvstore/KVStoreInterfaceService.js').KVStoreInterface} kvStoreService
 * @param {string} lockToken
 * @param {string} filePath
 * @returns
 */
export const refreshLock = ( suService, kvStoreService, lockToken, filePath ) => {
    return suService.sudo(async () => {
        kvStoreService.expireAt({
            key: `${LOCK_PREFIX}${lockToken}`,
            timestamp: (Date.now() / 1000 ) + DAV_LOCK_DURATION,
        });
        kvStoreService.expireAt({
            key: `${LOCK_PREFIX}${filePath}`,
            timestamp: (Date.now() / 1000 ) + DAV_LOCK_DURATION,
        });
        return lockToken;
    });
};

/**
 * @param {{sudo:Function}} suService
 * @param {import('../../modules/kvstore/KVStoreInterfaceService.js').KVStoreInterface} kvStoreService
 * @param {string} filePath
 * @returns {Promise<{lockToken: string, lockScope: 'shared' | 'exclusive', lockType?: string}[]>}
 */
export const getFileLocks = ( suService, kvStoreService, filePath ) => {
    return suService.sudo(async () => {
        const parentPaths = filePath.split('/');
        const filePaths = parentPaths.map((_, i, paths) => `${LOCK_PREFIX}${paths.slice(0, i + 1).join('/')}`).filter(Boolean);
        const tokenMapList = await kvStoreService.get({
            key: filePaths.slice(2),
        });
        return tokenMapList.flatMap(tokenMap => Object.entries(tokenMap ?? {}).map(([ lockToken, lockInfo ]) => ({
            lockToken: lockToken.replace(LOCK_PREFIX, ''),
            ...lockInfo,
        }))).filter(Boolean);
    });
};

/**
 * @param {{sudo:Function}} suService
 * @param {import('../../modules/kvstore/KVStoreInterfaceService.js').KVStoreInterface} kvStoreService
 * @param {string} filePath
 * @param {string} headerLockToken
 * @returns {Promise<boolean>}
 */
export const hasWritePermissionInDAV = async ( suService, kvStoreService, filePath, headerLockToken ) => {

    // if no lock on file, allow write
    const locksOnFile = await getFileLocks(suService, kvStoreService, filePath);
    if ( !locksOnFile?.length ) {
        return true;
    }

    if ( !headerLockToken ) {
        return false;
    }

    const existingFileFromLock = (await getLocksIfValid(suService, kvStoreService, headerLockToken))?.pop();
    if ( !filePath.startsWith(existingFileFromLock.path)  ) {
        return false;
    }

    const lock = locksOnFile.find(( l ) => l.lockToken === headerLockToken);
    if ( !lock ) {
        return false;
    }

    if ( lock.lockScope === 'exclusive' ) {
        // only 1 exclusive lock can exist, and headerLockToken matches it, allow write
        return true;
    }

    // if lock(s) on file are shared locks, and headerLockToken is one of them, allow write
    if ( lock.lockScope === 'shared' ) {
        // this lock should not exist if there are any exclusive locks
        return locksOnFile.find(( l ) => l.lockScope === 'exclusive') === undefined;
    }

    // else, deny write
    return false;
};