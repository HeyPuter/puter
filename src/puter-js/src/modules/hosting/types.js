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

/**
 * A DNS record the user sets at their DNS provider for a custom domain.
 *
 * @typedef {Object} CustomDomainRecord
 * @property {'CNAME' | 'TXT'} type Record type.
 * @property {string} name Record name (host).
 * @property {string} value Record value.
 * @property {'routing' | 'ownership' | 'certificate'} purpose What the record is for.
 * @property {boolean} required `true` for the record traffic needs; the others only
 * speed verification up.
 */

/**
 * A domain the user owns, attached to one of their hosted sites.
 *
 * @typedef {Object} CustomDomain
 * @property {string} uuid Unique identifier of the custom domain.
 * @property {string} hostname The domain, e.g. `www.example.com`.
 * @property {string} site The subdomain it serves, e.g. `example` for `example.puter.site`.
 * @property {'pending' | 'active' | 'failed'} status `active` once DNS is set up and the
 * domain serves the site; `pending` until then.
 * @property {string | null} statusDetail Why the domain is not active yet, when known.
 * @property {boolean} isApex Whether the hostname is a root domain (`example.com`), which
 * some DNS providers can't point with a CNAME.
 * @property {CustomDomainRecord[]} records DNS records to set.
 * @property {number} createdAt When the domain was added, in milliseconds since the epoch.
 * @property {number | null} activatedAt When the domain went active, if it has.
 */

export {};
