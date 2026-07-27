import { defineOperation } from './scaffold.js';
import stat from './stat.js';

/**
 * Creates a URL that reads the file at `path` without further authentication.
 *
 * `expiresIn` is how long the URL stays valid, as a
 * [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken#usage) duration
 * string (e.g. `'24h'`, `'30d'`; units `s`, `m`, `h`, `d`, `w`, `y`) or a
 * number of seconds. Directories cannot be read this way.
 *
 * @type {(path: string, expiresIn?: string | number) => Promise<string>}
 */
const getReadURL = defineOperation({
    positional: ['path', 'expiresIn'],
    async request (options) {
        const { uid, is_dir } = await stat.call(this, options.path);
        if ( is_dir ) {
            throw 'Cannot create readUrl for directory';
        }

        return {
            endpoint: '/auth/create-access-token',
            body: {
                expiresIn: options.expiresIn ?? '24h',
                permissions: [
                    `fs:${uid}:read`,
                ],
            },
            transform: ({ token }) =>
                `${this.APIOrigin}/token-read?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`,
        };
    },
});

export default getReadURL;
