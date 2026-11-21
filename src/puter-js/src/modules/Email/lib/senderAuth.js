/** @typedef {import('../types.js').EmailSenderAuth} EmailSenderAuth */

const HEADER = 'x-puter-sender-auth';
const RESULTS = new Set(['pass', 'fail', 'temperror']);

/** @param {string | undefined} list @returns {string[]} */
const domains = (list) =>
    !list || list === 'none' ? [] : list.split(',').map(name => name.trim()).filter(Boolean);

/**
 * The sender check Puter recorded on a message, from its first
 * `X-Puter-Sender-Auth` header: `<result>; from=<domains>; signed-by=<domains|none>[; via=local]`.
 * Puter puts its own header first and drops any the sender supplied.
 *
 * @param {import('postal-mime').Header[] | undefined} headers
 * @returns {EmailSenderAuth | null}
 */
export const parseSenderAuth = (headers) => {
    const header = headers?.find(h => h.key === HEADER);
    if ( ! header ) return null;
    const [result, ...params] = String(header.value).split(';').map(part => part.trim());
    if ( ! RESULTS.has(result) ) return null;
    /** @type {Record<string, string>} */
    const named = {};
    for ( const param of params ) {
        const eq = param.indexOf('=');
        if ( eq > 0 ) named[param.slice(0, eq).trim().toLowerCase()] = param.slice(eq + 1).trim();
    }
    return {
        result: /** @type {EmailSenderAuth['result']} */ (result),
        from: domains(named.from),
        signedBy: domains(named['signed-by']),
        local: named.via === 'local',
    };
};
