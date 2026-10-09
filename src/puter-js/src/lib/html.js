/**
 * Escapes text for use inside HTML element content or a quoted attribute.
 *
 * @param {unknown} text
 * @returns {string}
 */
export const escapeHtml = (text) =>
    String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
