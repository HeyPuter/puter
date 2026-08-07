// Helpers for inspecting and decoding `data:` URLs (used for thumbnails).

/**
 * Estimate the decoded byte size of a data URL (or raw base64 string) without
 * actually decoding it.
 *
 * @param {string} dataUrl
 * @returns {number}
 */
export const estimateDataUrlSize = (dataUrl) => {
    if ( ! dataUrl ) return 0;
    const commaIndex = dataUrl.indexOf(',');
    const base64 = commaIndex === -1 ? dataUrl : dataUrl.slice(commaIndex + 1);
    return Math.ceil(base64.length * 3 / 4);
};

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export const isDataUrl = (value) => {
    return typeof value === 'string' && value.startsWith('data:');
};

/**
 * Extract the content type declared in a data URL, defaulting to
 * `application/octet-stream`.
 *
 * @param {string} dataUrl
 * @returns {string | undefined}
 */
export const parseDataUrlContentType = (dataUrl) => {
    if ( ! isDataUrl(dataUrl) ) return undefined;
    const commaIndex = dataUrl.indexOf(',');
    const metadata = commaIndex === -1
        ? dataUrl.slice(5)
        : dataUrl.slice(5, commaIndex);
    const [rawContentType] = metadata.split(';');
    const contentType = rawContentType ? rawContentType.trim() : '';
    return contentType || 'application/octet-stream';
};

/**
 * @param {string} dataUrl
 * @returns {Promise<Blob>}
 */
export const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    if ( ! response.ok ) {
        throw new Error('Failed to read thumbnail data URL');
    }
    return await response.blob();
};
