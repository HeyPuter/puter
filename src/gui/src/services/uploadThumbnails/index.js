import { defaultThumbnailGenerator } from '../../../../puter-js/src/modules/FileSystem/operations/upload/thumbnails.js';
import {
    PDFJS_VERSION,
    PDF_THUMBNAIL_ASSET_PATH,
    PDF_THUMBNAIL_MAX_FILE_BYTES,
    PDF_THUMBNAIL_BATCH_TIMEOUT_MS,
    PDF_THUMBNAIL_JOB_TIMEOUT_MS,
    PDF_THUMBNAIL_MAX_BYTES,
    OFFICE_BATCH_TIMEOUT_MS,
    VIDEO_BATCH_TIMEOUT_MS,
} from './config.js';
import { readDocPreview } from './doc.js';
import { readDocxPreview } from './docx.js';
import { readPsdPreview } from './psd.js';
import { readVideoFrame } from './video.js';
import { readXlsxPreview } from './xlsx.js';

// Capture the bundle URL during evaluation; currentScript is null when an upload starts.
const bundleUrl = globalThis.document?.currentScript?.src;
const workerUrl = bundleUrl
    ? new URL(`pdf-thumbnails/${PDFJS_VERSION}/worker.js`, bundleUrl).href
    : `${PDF_THUMBNAIL_ASSET_PATH}worker.js`;
const useWorkerWrapper = bundleUrl && new URL(bundleUrl).origin !== globalThis.location?.origin;

const pendingJobs = new Set();
let activeJob;
let startingJobs = false;

const startNextJob = () => {
    if ( startingJobs ) return;
    startingJobs = true;
    try {
        while ( !activeJob && pendingJobs.size ) {
            const job = pendingJobs.values().next().value;
            pendingJobs.delete(job);
            activeJob = job;
            job.start();
        }
    } finally {
        startingJobs = false;
    }
};

const generatePdfThumbnail = (file, deadline, signal) => new Promise(resolve => {
    let worker;
    let workerBlobUrl;
    let settled = false;
    let jobTimer;
    let deadlineTimer;
    const finish = (thumbnail) => {
        if ( settled ) return;
        settled = true;
        clearTimeout(jobTimer);
        clearTimeout(deadlineTimer);
        signal?.removeEventListener('abort', onAbort);
        worker?.terminate();
        if ( workerBlobUrl ) URL.revokeObjectURL(workerBlobUrl);
        pendingJobs.delete(job);
        if ( activeJob === job ) activeJob = undefined;
        resolve(thumbnail);
        startNextJob();
    };
    const onAbort = () => finish();
    const job = {
        start: () => {
            if ( signal?.aborted || Date.now() >= deadline ) {
                finish();
                return;
            }
            try {
                // Worker entry URLs must be same-origin; module imports can use the asset host's CORS policy.
                if ( useWorkerWrapper ) {
                    workerBlobUrl = URL.createObjectURL(new Blob([`import ${JSON.stringify(workerUrl)};`], {
                        type: 'text/javascript',
                    }));
                }
                // All parsing, file reads and rasterization stay off the desktop thread.
                worker = new Worker(workerBlobUrl || workerUrl, { type: 'module' });
                worker.onmessage = ({ data: message }) => {
                    if ( message?.type !== 'thumbnail' ) return;
                    const data = message.thumbnail;
                    const valid = typeof data === 'string' && data.startsWith('data:image/png;base64,') &&
                        data.length <= Math.ceil(PDF_THUMBNAIL_MAX_BYTES / 3) * 4 + 22;
                    finish(valid ? data : undefined);
                };
                worker.onerror = (event) => {
                    event.preventDefault();
                    finish();
                };
                worker.onmessageerror = () => finish();
                jobTimer = setTimeout(() => finish(), PDF_THUMBNAIL_JOB_TIMEOUT_MS);
                worker.postMessage(file);
            } catch {
                finish();
            }
        },
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    deadlineTimer = setTimeout(() => finish(), Math.max(0, deadline - Date.now()));
    pendingJobs.add(job);
    startNextJob();
});

const WORD_TYPE = /^application\/(msword$|vnd\.ms-word\.|vnd\.openxmlformats-officedocument\.wordprocessingml\.)/;
const SPREADSHEET_TYPE = /^application\/vnd\.(ms-excel\.(sheet|template)\.|openxmlformats-officedocument\.spreadsheetml\.)/;
// The containers browsers play. Other `video/` types are left alone: a `.ts` source file is reported as one.
const VIDEO_TYPE = /^video\/(mp4|quicktime|webm|x-m4v)$/;

/**
 * Make a queue that runs one task at a time, and skips the tasks still waiting `timeoutMs` after the first started.
 *
 * @param {number} timeoutMs
 * @returns {<T>(task: () => Promise<T>, signal?: AbortSignal) => Promise<T | undefined>}
 */
const createQueue = (timeoutMs) => {
    let deadline;
    let last = Promise.resolve();
    return (task, signal) => {
        const result = last.then(() => {
            deadline ??= Date.now() + timeoutMs;
            return signal?.aborted || Date.now() >= deadline ? undefined : task();
        });
        last = result.catch(() => {});
        return result;
    };
};

/** Create one callback per upload so the files of one kind queued in it share a preparation deadline. */
export const createUploadThumbnailGenerator = () => {
    let deadline;
    // Office documents are read on the desktop thread, and a video takes a decoder, so each kind goes one at a time.
    const queueOffice = createQueue(OFFICE_BATCH_TIMEOUT_MS);
    const queueVideo = createQueue(VIDEO_BATCH_TIMEOUT_MS);
    return async (file, context) => {
        try {
            if ( context?.signal?.aborted ) return undefined;
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
            if ( ! isPdf ) {
                // SDKs that predate the callback context pass only the file; images still need thumbnails then.
                const imageGenerator = typeof context?.defaultGenerator === 'function'
                    ? context.defaultGenerator
                    : defaultThumbnailGenerator;
                const name = file.name || '';
                // Browsers can't decode these, so the image generator gets a small image made from the file instead.
                let image = file;
                if ( file.type === 'image/vnd.adobe.photoshop' || /\.ps[db]$/i.test(name) ) {
                    image = await readPsdPreview(file, context?.signal);
                } else if ( WORD_TYPE.test(file.type) || /\.do[ct][xm]?$/i.test(name) ) {
                    // A name doesn't settle which of the two formats a document is in. Each reader checks the signature.
                    image = await queueOffice(async () => await readDocxPreview(file, context?.signal) ??
                        readDocPreview(file, context?.signal), context?.signal);
                } else if ( SPREADSHEET_TYPE.test(file.type) || /\.xl[st][xm]$/i.test(name) ) {
                    image = await queueOffice(() => readXlsxPreview(file, context?.signal), context?.signal);
                } else if ( VIDEO_TYPE.test(file.type) || /\.(mp4|m4v|mov|webm)$/i.test(name) ) {
                    image = await queueVideo(() => readVideoFrame(file, context?.signal), context?.signal);
                }
                return image ? await imageGenerator(image) : undefined;
            }
            if ( ! file.size || file.size > PDF_THUMBNAIL_MAX_FILE_BYTES ||
                typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ) {
                return undefined;
            }
            deadline ??= Date.now() + PDF_THUMBNAIL_BATCH_TIMEOUT_MS;
            if ( Date.now() >= deadline ) return undefined;
            return await generatePdfThumbnail(file, deadline, context?.signal);
        } catch {
            return undefined;
        }
    };
};
