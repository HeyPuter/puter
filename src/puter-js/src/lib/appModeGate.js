/**
 * Whether this document is allowed to run the SDK in `app` mode.
 *
 * `env = 'app'` is decided by the presence of a `puter.app_instance_id` URL
 * parameter, which a crafted link can put on any page — and app mode is what
 * makes the URL's `puter.api_origin` and `puter.auth.token` authoritative. The
 * GUI only ever launches an app into an iframe, so a top-level document
 * presenting those parameters is a third-party site, not an app.
 *
 * This does not attest that the framing document _is_ the Puter GUI — a
 * cross-origin ancestor's identity is not readable. The token-adoption paths
 * carry that half, by binding every stored token to the API origin it was
 * minted against.
 *
 * @param {typeof globalThis} [scope] - Global to inspect; injectable for tests.
 * @returns {boolean} True when the scope is a framed document.
 */
export const isFramedDocument = (scope = globalThis) => {
    try {
        const parent = scope?.parent;
        // Workers have no `parent`; a top-level document is its own.
        return !!parent && parent !== scope;
    } catch {
        // Reading `parent` can throw only in an embedded context, so an
        // exception is itself evidence of framing.
        return true;
    }
};
