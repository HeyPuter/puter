// Shapes shared across the `puter.hosting` operations. JSDoc-only; no runtime exports.

/**
 * A subdomain hosted on Puter, containing its details.
 *
 * @typedef {Object} Subdomain
 * @property {string} uid Unique identifier of the subdomain.
 * @property {string} subdomain Name of the subdomain, i.e. the part before the main domain
 * (e.g. `example` in `example.puter.site`).
 * @property {import('../FSItem.js').FSItem} root_dir The root directory of the subdomain, where its
 * files are stored.
 */

export {};
