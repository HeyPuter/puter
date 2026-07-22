import * as utils from '../../../lib/utils.js';

// Shared argument-shape helpers for the puter.ai methods. Every method
// accepts a mix of positional shorthands, an options object, and trailing
// boolean test-mode flags; these keep that parsing in one place.

/** @returns {value is Blob | File} */
export const isBlobLike = (value) => {
    if ( typeof Blob === 'undefined' ) return false;
    return value instanceof Blob || (typeof File !== 'undefined' && value instanceof File);
};

/** @returns {value is Record<string, unknown>} */
export const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) && !isBlobLike(value);

// True when any of the trailing arguments is the boolean flag `true`.
export const hasTestModeFlag = (values) =>
    values.some((value) => value === true);

// Blob (or File) inputs are sent to the drivers as data URIs.
export const toDataUriIfBlob = async (value) => {
    if ( value instanceof Blob ) {
        return await utils.blobToDataUri(value);
    }
    return value;
};

// Byte size encoded in a `data:` URI's base64 payload, without decoding it.
export const dataUriByteLength = (dataUri) => {
    const base64 = dataUri.split(',')[1] || '';
    const padding = base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0);
    return Math.floor((base64.length * 3) / 4) - padding;
};
