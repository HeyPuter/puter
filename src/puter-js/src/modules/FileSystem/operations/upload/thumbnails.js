// Client-side thumbnail generation for image uploads. All entry points are
// best-effort: any failure resolves to `undefined` so the upload proceeds
// without a thumbnail rather than failing.

import {
    MAX_THUMBNAIL_BYTES,
    DEFAULT_THUMBNAIL_DIMENSION,
    MIN_THUMBNAIL_DIMENSION,
} from './constants.js';
import { estimateDataUrlSize, isDataUrl } from './dataUrl.js';

const isLikelyImageFile = (file) => {
    if ( ! file ) return false;
    if ( file.type && file.type.startsWith('image/') ) return true;
    const name = (file.name || '').toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.avif', '.jfif'].some(ext => name.endsWith(ext));
};

/**
 * Drop thumbnail payloads that are missing or too large to bother sending.
 *
 * @param {unknown} thumbnailData
 * @returns {string | undefined}
 */
export const normalizeThumbnailData = (thumbnailData) => {
    if ( typeof thumbnailData !== 'string' || thumbnailData.length === 0 ) {
        return undefined;
    }
    if ( isDataUrl(thumbnailData) && estimateDataUrlSize(thumbnailData) > MAX_THUMBNAIL_BYTES ) {
        return undefined;
    }
    return thumbnailData;
};

const scaleDimensions = (width, height, maxDim) => {
    const base = Math.max(width, height) || 1;
    const scale = Math.min(1, maxDim / base);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    return { width: w, height: h };
};

const loadImageFromFile = (file) => new Promise((resolve, reject) => {
    if ( typeof document === 'undefined' || typeof URL === 'undefined' || typeof Image === 'undefined' ) return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
    };
    img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
    };
    img.src = url;
});

const renderThumbnail = (img, maxDim, type, quality) => {
    if ( !img || typeof document === 'undefined' ) return null;
    const { width, height } = scaleDimensions(img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if ( ! ctx ) return null;
    ctx.drawImage(img, 0, 0, width, height);
    try {
        return canvas.toDataURL(type, quality);
    } catch (e) {
        return null;
    }
};

/**
 * Render a downscaled thumbnail data URL for an image `File`, shrinking
 * dimensions and trying successively cheaper formats until it fits under
 * {@link MAX_THUMBNAIL_BYTES}. Returns `undefined` when unsupported or on error.
 *
 * @param {File} file
 * @returns {Promise<string | undefined>}
 */
export const defaultThumbnailGenerator = async (file) => {
    try {
        if ( typeof document === 'undefined' ) return undefined;
        if ( typeof File === 'undefined' || !(file instanceof File) ) return undefined;
        if ( ! isLikelyImageFile(file) ) return undefined;

        const img = await loadImageFromFile(file);
        if ( ! img ) return undefined;

        let dimension = DEFAULT_THUMBNAIL_DIMENSION;
        const formats = [
            { type: 'image/webp', quality: 0.85 },
            { type: 'image/jpeg', quality: 0.8 },
            { type: 'image/png' },
        ];

        while ( dimension >= MIN_THUMBNAIL_DIMENSION ) {
            for ( const { type, quality } of formats ) {
                const dataUrl = renderThumbnail(img, dimension, type, quality);
                if ( ! dataUrl ) continue;
                if ( estimateDataUrlSize(dataUrl) <= MAX_THUMBNAIL_BYTES ) {
                    return dataUrl;
                }
            }
            dimension = Math.floor(dimension / 2);
        }
    } catch (e) {
        // Ignore thumbnail errors; upload should proceed without them.
        return undefined;
    }

    return undefined;
};

/**
 * Generate a thumbnail per file, positionally aligned with `files`. Returns an
 * empty array when thumbnail generation was not requested.
 *
 * @param {File[]} files
 * @param {{ generateThumbnails?: boolean, thumbnailGenerator?: (file: File) => Promise<string | undefined> }} options
 * @returns {Promise<Array<string | undefined>>}
 */
export const generateThumbnails = async (files, options) => {
    const shouldGenerateThumbnails = options.generateThumbnails || options.thumbnailGenerator;
    if ( ! files.length || ! shouldGenerateThumbnails ) {
        return [];
    }

    const generator = options.thumbnailGenerator || defaultThumbnailGenerator;
    return await Promise.all(files.map(async (file) => {
        try {
            return await generator(file);
        } catch (e) {
            return undefined;
        }
    }));
};
