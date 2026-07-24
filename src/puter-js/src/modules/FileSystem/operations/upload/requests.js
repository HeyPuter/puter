// HTTP helpers shared by the upload strategies: JSON API calls against the
// FileSystem endpoints and raw blob PUTs to signed storage URLs.

import { fetchUrl } from '../../../../lib/networkUtils.js';

const parseFetchResponseBody = async (response) => {
    const text = await response.text();
    if ( ! text ) return null;

    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
};

const createApiHeaders = (authToken) => {
    const headers = {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
    };

    // Origin is not set here: browsers forbid it (and set the real one), and
    // the non-browser xhrshim already sets `origin: https://puter.work` itself.
    return headers;
};

const toRequestError = (response, body, fallbackMessage) => {
    const bodyRecord = body && typeof body === 'object' ? body : null;
    const message = bodyRecord?.message
        ?? (typeof bodyRecord?.error === 'string' ? bodyRecord.error : bodyRecord?.error?.message)
        ?? (typeof body === 'string' && body.length > 0 ? body : null)
        ?? fallbackMessage
        ?? `Request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    if ( typeof bodyRecord?.code === 'string' && bodyRecord.code.length > 0 ) {
        error.code = bodyRecord.code;
    } else if ( typeof bodyRecord?.errorCode === 'string' && bodyRecord.errorCode.length > 0 ) {
        error.code = bodyRecord.errorCode;
    }
    return error;
};

/**
 * POST a JSON payload to a FileSystem endpoint and return the parsed body,
 * throwing a rich error (carrying `status`, `body`, and `code`) on failure.
 *
 * @param {string} apiOrigin
 * @param {string} authToken
 * @param {string} endpoint
 * @param {unknown} payload
 * @returns {Promise<unknown>}
 */
export const postJson = async (apiOrigin, authToken, endpoint, payload) => {
    const response = await fetchUrl(`${apiOrigin}${endpoint}`, {
        method: 'POST',
        headers: createApiHeaders(authToken),
        body: JSON.stringify(payload),
    });
    const body = await parseFetchResponseBody(response);
    if ( ! response.ok ) {
        throw toRequestError(response, body, `Failed request to ${endpoint}`);
    }
    return body;
};

/**
 * Best-effort extraction of a human-readable message from an arbitrary error
 * shape (Error, request error with `body`, or plain value).
 *
 * @param {unknown} error
 * @returns {string}
 */
export const toErrorMessage = (error) => {
    if ( error && typeof error === 'object' ) {
        if ( typeof error.message === 'string' && error.message.length > 0 ) {
            return error.message;
        }
        if ( typeof error.body === 'string' && error.body.length > 0 ) {
            return error.body;
        }
        if ( error.body && typeof error.body === 'object' ) {
            if ( typeof error.body.message === 'string' && error.body.message.length > 0 ) {
                return error.body.message;
            }
            if (
                error.body.error &&
                typeof error.body.error === 'object' &&
                typeof error.body.error.message === 'string' &&
                error.body.error.message.length > 0
            ) {
                return error.body.error.message;
            }
        }
    }
    return String(error);
};

/**
 * PUT a blob to a signed storage URL via XHR, reporting incremental progress
 * and exposing the underlying request for cancellation.
 *
 * @param {{
 *   url: string,
 *   blob: Blob,
 *   contentType?: string,
 *   onProgress?: (deltaBytes: number) => void,
 *   onRequestCreated?: (request: XMLHttpRequest) => void,
 *   onRequestCompleted?: (request: XMLHttpRequest) => void,
 * }} params
 * @returns {Promise<{ etag: string | null }>}
 */
export const uploadBlobToSignedUrl = async ({
    url,
    blob,
    contentType,
    onProgress,
    onRequestCreated,
    onRequestCompleted,
}) => {
    return await new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open('PUT', url, true);
        request.withCredentials = false;

        if ( contentType ) {
            request.setRequestHeader('Content-Type', contentType);
        }

        if ( onRequestCreated ) {
            onRequestCreated(request);
        }

        let previousLoaded = 0;
        request.upload.addEventListener('progress', (event) => {
            if ( ! onProgress ) return;
            if ( ! event.lengthComputable ) return;

            const delta = Math.max(0, event.loaded - previousLoaded);
            previousLoaded = event.loaded;
            if ( delta > 0 ) {
                onProgress(delta);
            }
        });

        request.onload = () => {
            if ( onRequestCompleted ) {
                onRequestCompleted(request);
            }

            if ( blob.size > previousLoaded && onProgress ) {
                onProgress(blob.size - previousLoaded);
            }

            if ( request.status >= 200 && request.status < 300 ) {
                const etag = request.getResponseHeader('etag') ?? request.getResponseHeader('ETag');
                resolve({ etag });
                return;
            }

            const error = new Error(`Signed upload failed with status ${request.status}`);
            error.status = request.status;
            reject(error);
        };

        request.onerror = () => {
            if ( onRequestCompleted ) {
                onRequestCompleted(request);
            }
            const error = new Error('Network error during signed upload');
            error.status = request.status;
            reject(error);
        };

        request.onabort = () => {
            if ( onRequestCompleted ) {
                onRequestCompleted(request);
            }
            const error = new Error('Signed upload aborted');
            error.aborted = true;
            reject(error);
        };

        request.send(blob);
    });
};
