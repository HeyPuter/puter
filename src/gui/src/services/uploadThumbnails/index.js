import { defaultThumbnailGenerator } from '../../../../puter-js/src/modules/FileSystem/operations/upload/thumbnails.js';
import { readAudioCover } from './audio.js';
import { readCodePreview } from './code.js';
import {
    AUDIO_BATCH_TIMEOUT_MS,
    HEIF_BATCH_TIMEOUT_MS,
    PDFJS_VERSION,
    PDF_THUMBNAIL_ASSET_PATH,
    PDF_THUMBNAIL_MAX_FILE_BYTES,
    PDF_THUMBNAIL_BATCH_TIMEOUT_MS,
    PDF_THUMBNAIL_JOB_TIMEOUT_MS,
    PDF_THUMBNAIL_MAX_BYTES,
    OFFICE_BATCH_TIMEOUT_MS,
    TEXT_BATCH_TIMEOUT_MS,
    VIDEO_BATCH_TIMEOUT_MS,
} from './config.js';
import { readCsvPreview } from './csv.js';
import { readDocPreview } from './doc.js';
import { readDocxPreview } from './docx.js';
import { readEmbeddedPreview } from './embedded.js';
import { readHeifPreview } from './heif.js';
import {
    AUDIO_NAME,
    AUDIO_TYPE,
    CSV_NAME,
    CSV_TYPE,
    HEIF_NAME,
    HEIF_TYPE,
    ILLUSTRATOR_NAME,
    MARKDOWN_NAME,
    MARKDOWN_TYPE,
    PDF_NAME,
    PRESENTATION_NAME,
    PRESENTATION_TYPE,
    PSD_NAME,
    PSD_TYPE,
    SPREADSHEET_NAME,
    SPREADSHEET_TYPE,
    VIDEO_NAME,
    VIDEO_TYPE,
    WORD_NAME,
    WORD_TYPE,
    codeLanguage,
    isPreviewPackage,
    leadingBytesRead,
} from './kinds.js';
import { readMarkdownPreview } from './markdown.js';
import { readPptxPreview } from './pptx.js';
import { readPsdPreview } from './psd.js';
import { readVideoFrame } from './video.js';
import { readXlsxPreview } from './xlsx.js';

// Capture the bundle URL during evaluation; currentScript is null when an upload starts.
const bundleUrl = globalThis.document?.currentScript?.src;
const workerUrl = bundleUrl
    ? new URL(`pdf-thumbnails/${PDFJS_VERSION}/worker.js`, bundleUrl).href
    : `${PDF_THUMBNAIL_ASSET_PATH}worker.js`;
const useWorkerWrapper = bundleUrl && new URL(bundleUrl).origin !== globalThis.location?.origin;

/**
 * Draw a page or a sheet from the start of a text file.
 *
 * @param {File} file
 * @returns {Promise<File | undefined>}
 */
const readTextPreview = (file) => {
    const name = file.name || '';
    const language = codeLanguage(name, file.type);
    if ( language ) return readCodePreview(file, language);
    if ( CSV_TYPE.test(file.type) || CSV_NAME.test(name) ) return readCsvPreview(file);
    if ( MARKDOWN_TYPE.test(file.type) || MARKDOWN_NAME.test(name) ) return readMarkdownPreview(file);
    return Promise.resolve(undefined);
};

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

/**
 * Make a queue that runs one task at a time, until `timeoutMs` after the first one started. At that deadline the task
 * under way is given up on and the ones still waiting are skipped, so the upload waits no longer than that.
 *
 * @param {number} timeoutMs
 * @returns {<T>(task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) => Promise<T | undefined>} A task
 *     gets a signal that aborts at the deadline, or when the caller's signal does.
 */
const createQueue = (timeoutMs) => {
    let deadline;
    let last = Promise.resolve();
    return (task, signal) => {
        const result = last.then(async () => {
            deadline ??= Date.now() + timeoutMs;
            const remaining = deadline - Date.now();
            if ( signal?.aborted || remaining <= 0 ) return undefined;
            const controller = new AbortController();
            const abort = () => controller.abort();
            const timer = setTimeout(abort, remaining);
            signal?.addEventListener('abort', abort, { once: true });
            try {
                // A task can be waiting on a read or a decoder that never answers, so its own end is not waited for.
                return await Promise.race([
                    task(controller.signal),
                    new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(undefined), { once: true })),
                ]);
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
            }
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
    const queueAudio = createQueue(AUDIO_BATCH_TIMEOUT_MS);
    const queueHeif = createQueue(HEIF_BATCH_TIMEOUT_MS);
    const queueText = createQueue(TEXT_BATCH_TIMEOUT_MS);
    // Whether this browser decodes HEIC photos itself, which is known once it has been given one.
    let decodesHeif;
    return async (file, context) => {
        try {
            if ( context?.signal?.aborted ) return undefined;
            // An Illustrator file goes to the PDF renderer only when it starts as a PDF does, since loading the
            // renderer for a file it can't read would be wasted.
            const isPdf = file.type === 'application/pdf' || PDF_NAME.test(file.name || '') ||
                (ILLUSTRATOR_NAME.test(file.name || '') && (await file.slice(0, 1024).text()).includes('%PDF-'));
            if ( ! isPdf ) {
                // SDKs that predate the callback context pass only the file; images still need thumbnails then.
                const imageGenerator = typeof context?.defaultGenerator === 'function'
                    ? context.defaultGenerator
                    : defaultThumbnailGenerator;
                const name = file.name || '';
                // Browsers can't decode these, so the image generator gets a small image made from the file instead.
                let image = file;
                if ( file.type === PSD_TYPE || PSD_NAME.test(name) ) {
                    image = await readPsdPreview(file, context?.signal);
                } else if ( WORD_TYPE.test(file.type) || WORD_NAME.test(name) ) {
                    // A name doesn't settle which of the two formats a document is in. Each reader checks the signature.
                    image = await queueOffice(async signal => await readDocxPreview(file, signal) ??
                        readDocPreview(file, signal), context?.signal);
                } else if ( SPREADSHEET_TYPE.test(file.type) || SPREADSHEET_NAME.test(name) ) {
                    image = await queueOffice(signal => readXlsxPreview(file, signal), context?.signal);
                } else if ( PRESENTATION_TYPE.test(file.type) || PRESENTATION_NAME.test(name) ) {
                    image = await queueOffice(signal => readPptxPreview(file, signal), context?.signal);
                } else if ( isPreviewPackage(name, file.type) ) {
                    // These carry a picture of themselves, made by the editor that saved them. A book's cover can be
                    // large, and a library is many books, so one picture is scaled before the next file is opened.
                    return await queueOffice(async (signal) => {
                        const picture = await readEmbeddedPreview(file, signal);
                        return picture ? imageGenerator(picture) : undefined;
                    }, context?.signal);
                } else if ( HEIF_TYPE.test(file.type) || HEIF_NAME.test(name) ) {
                    // Safari decodes these itself. The image generator goes by a file's type, and not every browser
                    // gives these one.
                    if ( decodesHeif !== false ) {
                        const typed = HEIF_TYPE.test(file.type) ? file : new File([file], name, { type: 'image/heic' });
                        const thumbnail = await imageGenerator(typed);
                        decodesHeif ??= !!thumbnail;
                        if ( thumbnail ) return thumbnail;
                    }
                    // Elsewhere the device's video decoder decodes the picture inside, one photo at a time.
                    return await queueHeif(async (signal) => {
                        const picture = await readHeifPreview(file, signal);
                        return picture ? imageGenerator(picture) : undefined;
                    }, context?.signal);
                } else if ( AUDIO_TYPE.test(file.type) || AUDIO_NAME.test(name) ) {
                    // An album is many files that each hold the same large cover, so one cover is found and scaled
                    // before the next file is opened.
                    return await queueAudio(async (signal) => {
                        const cover = await readAudioCover(file, signal);
                        return cover ? imageGenerator(cover) : undefined;
                    }, context?.signal);
                } else if ( VIDEO_TYPE.test(file.type) || VIDEO_NAME.test(name) ) {
                    image = await queueVideo(signal => readVideoFrame(file, signal), context?.signal);
                } else if ( leadingBytesRead(name, file.type) ) {
                    // A project folder is thousands of these, so one page is drawn and scaled before the next file
                    // is opened.
                    return await queueText(async () => {
                        const page = await readTextPreview(file);
                        return page ? imageGenerator(page) : undefined;
                    }, context?.signal);
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
