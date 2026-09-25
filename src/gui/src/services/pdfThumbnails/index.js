import { defaultThumbnailGenerator } from '../../../../puter-js/src/modules/FileSystem/operations/upload/thumbnails.js';
import {
    PDFJS_VERSION,
    PDF_THUMBNAIL_ASSET_PATH,
    PDF_THUMBNAIL_MAX_FILE_BYTES,
    PDF_THUMBNAIL_BATCH_TIMEOUT_MS,
    PDF_THUMBNAIL_JOB_TIMEOUT_MS,
    PDF_THUMBNAIL_MAX_BYTES,
} from './config.js';

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

/** Create one callback per upload so queued PDFs share a preparation deadline. */
export const createUploadThumbnailGenerator = () => {
    let deadline;
    return async (file, context) => {
        try {
            if ( context?.signal?.aborted ) return undefined;
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
            if ( ! isPdf ) {
                // SDKs that predate the callback context pass only the file; images still need thumbnails then.
                const imageGenerator = typeof context?.defaultGenerator === 'function'
                    ? context.defaultGenerator
                    : defaultThumbnailGenerator;
                return await imageGenerator(file);
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
