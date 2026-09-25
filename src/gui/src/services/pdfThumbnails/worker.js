// These imports are served beside this worker by the GUI build.
import { getDocument } from './pdf.mjs';
import { WorkerMessageHandler } from './pdf.worker.mjs';
import {
    PDF_THUMBNAIL_MAX_PIXELS,
    PDF_THUMBNAIL_DIMENSION,
    PDF_THUMBNAIL_MAX_BYTES,
} from './config.js';

// PDF.js's loopback transport keeps its parser in this disposable worker too.
globalThis.pdfjsWorker = { WorkerMessageHandler };

class ThumbnailCanvasFactory {
    create (width, height) {
        const canvas = new OffscreenCanvas(1, 1);
        this.reset({ canvas }, width, height);
        return { canvas, context: canvas.getContext('2d') };
    }

    reset ({ canvas }, width, height) {
        if ( !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
            Math.ceil(width) * Math.ceil(height) > PDF_THUMBNAIL_MAX_PIXELS ) {
            throw new Error('Thumbnail canvas exceeds budget');
        }
        canvas.width = Math.ceil(width);
        canvas.height = Math.ceil(height);
    }

    destroy (entry) {
        entry.canvas.width = entry.canvas.height = 0;
        entry.canvas = entry.context = null;
    }
}

self.onmessage = async ({ data: file }) => {
    let loadingTask;
    let canvas;
    let thumbnail;
    try {
        const assetUrl = directory => new URL(`${directory}/`, import.meta.url).href;
        loadingTask = getDocument({
            data: new Uint8Array(await file.arrayBuffer()),
            cMapUrl: assetUrl('cmaps'),
            standardFontDataUrl: assetUrl('standard_fonts'),
            wasmUrl: assetUrl('wasm'),
            iccUrl: assetUrl('iccs'),
            useWorkerFetch: true,
            disableFontFace: true,
            useSystemFonts: false,
            enableXfa: false,
            stopAtErrors: true,
            verbosity: 0,
            maxImageSize: PDF_THUMBNAIL_MAX_PIXELS,
            canvasMaxAreaInBytes: PDF_THUMBNAIL_MAX_PIXELS * 4,
            CanvasFactory: ThumbnailCanvasFactory,
        });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        // Resource-limit failures can resolve to an empty operator list.
        const operators = await page.getOperatorList();
        if ( ! operators.fnArray.length ) return;
        const baseViewport = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({
            scale: PDF_THUMBNAIL_DIMENSION / Math.max(baseViewport.width, baseViewport.height),
        });
        const target = new ThumbnailCanvasFactory().create(viewport.width, viewport.height);
        canvas = target.canvas;
        await page.render({
            canvasContext: target.context,
            viewport,
            background: 'rgb(255, 255, 255)',
        }).promise;
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        if ( blob.size <= PDF_THUMBNAIL_MAX_BYTES ) {
            thumbnail = new FileReaderSync().readAsDataURL(blob);
        }
    } catch {
        // Unsupported, encrypted and malformed PDFs retain their ordinary file icon.
    } finally {
        try {
            await loadingTask?.destroy();
        } catch {
            // The parent also terminates this worker, including on cleanup timeout.
        }
        if ( canvas ) canvas.width = canvas.height = 0;
        self.postMessage({ type: 'thumbnail', thumbnail });
    }
};
