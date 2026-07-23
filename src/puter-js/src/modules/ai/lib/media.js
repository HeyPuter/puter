import * as utils from '../../../lib/utils.js';

/**
 * Drivers return media payloads in several shapes (URL string, Blob,
 * ArrayBuffer, or a Response-like object). Reduce them all to a URL.
 *
 * @param {unknown} result
 * @param {{ code: string, message: string }} error - thrown when the shape is unrecognized
 * @returns {Promise<string>}
 */
const resultToUrl = async (result, error) => {
    if ( typeof result === 'string' ) {
        return result;
    }
    if ( result instanceof Blob ) {
        return await utils.blob_to_url(result);
    }
    if ( result instanceof ArrayBuffer ) {
        return await utils.blob_to_url(new Blob([result]));
    }
    if ( result && typeof result === 'object' && typeof result.arrayBuffer === 'function' ) {
        const arrayBuffer = await result.arrayBuffer();
        return await utils.blob_to_url(new Blob([arrayBuffer], { type: result.type || undefined }));
    }
    throw error;
};

// The element fallbacks keep these usable in workers and node, where the
// DOM constructors don't exist: callers still get `.src` and the URL via
// toString()/valueOf().

/**
 * @param {unknown} result
 * @returns {Promise<HTMLAudioElement>}
 */
export const toAudioElement = async (result) => {
    const url = await resultToUrl(result, { code: 'invalid_audio_response', message: 'Unexpected audio response format' });
    const audio = new (globalThis.Audio || Object)();
    audio.src = url;
    audio.toString = () => url;
    audio.valueOf = () => url;
    return audio;
};

/**
 * @param {unknown} result
 * @returns {Promise<HTMLImageElement>}
 */
export const toImageElement = async (result) => {
    const url = await resultToUrl(result, { code: 'invalid_image_response', message: 'Unexpected image response format' });
    const img = new (globalThis.Image || Object)();
    img.src = url;
    img.toString = () => img.src;
    img.valueOf = () => img.src;
    return img;
};

/**
 * Video results additionally carry their URL under several object keys and
 * fall through unchanged when no URL can be found.
 *
 * @param {unknown} result
 * @returns {Promise<HTMLVideoElement>}
 */
export const toVideoElement = async (result) => {
    let sourceUrl = null;
    let mimeType = null;
    if ( result instanceof Blob ) {
        sourceUrl = await utils.blob_to_url(result);
        mimeType = result.type || 'video/mp4';
    } else if ( typeof result === 'string' ) {
        sourceUrl = result;
    } else if ( result && typeof result === 'object' ) {
        sourceUrl = result.asset_url || result.url || result.href || null;
        mimeType = result.mime_type || result.content_type || null;
    }

    if ( ! sourceUrl ) {
        return result;
    }

    const video = (globalThis.document?.createElement('video') || { setAttribute: () => {
    } });
    video.src = sourceUrl;
    video.controls = true;
    video.preload = 'metadata';
    if ( mimeType ) {
        video.setAttribute('data-mime-type', mimeType);
    }
    video.setAttribute('data-source', sourceUrl);
    video.toString = () => video.src;
    video.valueOf = () => video.src;
    return video;
};
