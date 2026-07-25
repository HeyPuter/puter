// Shared argument-shape helpers for the puter.hosting methods.

// A subdomain may be passed either bare (`example`) or as a full hosted host
// (`example.puter.site` / `example.puter.com`); the latter is accepted so
// copy-pasting a site URL's host just works during development.
const SUBDOMAIN_HOST = /^[a-z0-9]+\.puter\.(site|com)$/;

/**
 * Returns just the subdomain label, stripping a trailing `.puter.site` /
 * `.puter.com` when the value is a full hosted host. Non-string or unrelated
 * values pass through unchanged.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export const normalizeSubdomain = (value) =>
    typeof value === 'string' && SUBDOMAIN_HOST.test(value) ? value.split('.')[0] : value;
