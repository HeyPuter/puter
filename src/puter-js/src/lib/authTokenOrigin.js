/**
 * Decides whether a stored auth token may be attached to requests destined
 * for a given API origin.
 *
 * In `app` mode the API origin is taken from a URL-controlled
 * `puter.api_origin` parameter, so a stored token must never be replayed to
 * an arbitrary origin. The rules are:
 *
 *   - A token that was stored with an explicit origin binding may only ever
 *     be replayed to that exact origin.
 *   - A token with no binding (a legacy token stored before origin binding
 *     existed) is only honored against the default API origin — never against
 *     a URL-supplied custom origin.
 *
 * @param {object} params
 * @param {string|null|undefined} params.boundOrigin - Origin the stored token
 *   was minted against, or null/undefined for an unbound (legacy) token.
 * @param {string} params.currentOrigin - The API origin the token would be
 *   used against right now.
 * @param {string} params.defaultAPIOrigin - The SDK's default (trusted) API
 *   origin for this deployment.
 * @returns {boolean} True if the token may be used for `currentOrigin`.
 */
export const isStoredTokenUsableForOrigin = ({
    boundOrigin,
    currentOrigin,
    defaultAPIOrigin,
}) => {
    if (boundOrigin) return boundOrigin === currentOrigin;
    return currentOrigin === defaultAPIOrigin;
};
