// The values `puter.perms.request` and `check` accept, as named constants.
// Each is also accepted as its plain string.

/** What a request is about. */
export const Resource = Object.freeze({
    FS: 'fs',
    FOLDER: 'folder',
    EMAIL: 'email',
    APPS: 'apps',
    SUBDOMAINS: 'subdomains',
    APP_DATA: 'appData',
    APP_ROOT_DIR: 'appRootDir',
    BACKGROUND_EVENTS: 'backgroundEvents',
    KV_SHARE: 'kvShare',
});

/** An access level. `WRITE` includes `READ`. */
export const Access = Object.freeze({
    READ: 'read',
    WRITE: 'write',
});

/** The special folders a `folder` request can name. */
export const Folder = Object.freeze({
    DESKTOP: 'Desktop',
    DOCUMENTS: 'Documents',
    PICTURES: 'Pictures',
    VIDEOS: 'Videos',
});
