export const MANAGE_PERM_PREFIX = 'manage';
export const PERM_KEY_PREFIX = 'perm';

/**
 * De-facto placeholder permission for permission rewrites that do not grant
 * any access.
 */
export const PERMISSION_FOR_NOTHING_IN_PARTICULAR = 'permission-for-nothing-in-particular';

/** TTL (seconds) for redis-cached permission scan readings. */
export const PERMISSION_SCAN_CACHE_TTL_SECONDS = 20;
