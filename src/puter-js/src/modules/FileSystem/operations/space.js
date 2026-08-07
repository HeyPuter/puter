import { defineOperation } from './scaffold.js';

/** @typedef {import('../../../../types/modules/filesystem').SpaceInfo} SpaceInfo */
/** @typedef {import('../../../../types/shared').RequestCallbacks<SpaceInfo>} SpaceCallbacks */

/**
 * Returns the storage capacity and usage of the current user, in bytes.
 *
 * @type {{
 *   (options?: SpaceCallbacks): Promise<SpaceInfo>,
 *   (
 *     success: (value: SpaceInfo) => void,
 *     error?: (reason: unknown) => void,
 *   ): Promise<SpaceInfo>,
 * }}
 */
const space = defineOperation({
    request () {
        return { endpoint: '/df' };
    },
});

export default space;
