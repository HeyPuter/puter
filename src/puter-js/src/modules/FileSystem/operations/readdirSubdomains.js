import { defineOperation } from './scaffold.js';

/**
 * @typedef {{
 *   directory_id: number,
 *   subdomains: unknown[],
 *   has_website: boolean,
 * }} DirectorySubdomains
 */

/**
 * Fetches the subdomains hosted out of each of the given directories, in one
 * request.
 *
 * @type {(options: {
 *   directory_ids: number[],
 *   success?: (value: DirectorySubdomains[]) => void,
 *   error?: (reason: unknown) => void,
 * }) => Promise<DirectorySubdomains[]>}
 */
const readdirSubdomains = defineOperation({
    request (options) {
        if ( !Array.isArray(options.directory_ids) || options.directory_ids.length === 0 ) {
            throw new Error('directory_ids must be a non-empty array');
        }

        return {
            endpoint: '/readdir-subdomains',
            // The token travels in the payload rather than the auth header.
            authHeader: false,
            body: {
                directory_ids: options.directory_ids,
                auth_token: this.authToken,
            },
        };
    },
});

export default readdirSubdomains;
