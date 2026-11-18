import { VIDEO_FRAME_DIMENSION, VIDEO_FRAME_MAX_SECONDS, VIDEO_JOB_TIMEOUT_MS } from './config.js';

/**
 * Get a frame from early in a video the browser can play, as a small JPEG. The browser's own player finds and
 * decodes the frame, reading only the parts of the file it needs.
 *
 * @param {File} file
 * @param {AbortSignal} [signal]
 * @returns {Promise<File | undefined>} `undefined` when the browser can't play the file, it has no picture, or
 *     loading it takes longer than `VIDEO_JOB_TIMEOUT_MS`.
 */
export const readVideoFrame = (file, signal) => new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    let timer;
    const finish = (frame) => {
        if ( settled ) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        // Without a source, the player lets go of its decoder and of the file.
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
        resolve(frame);
    };
    const onAbort = () => finish();
    timer = setTimeout(() => finish(), VIDEO_JOB_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onerror = () => finish();
    video.onloadedmetadata = () => {
        // A file with only sound has no size.
        if ( !video.videoWidth || !video.videoHeight ) return finish();
        // Videos often open on a black frame, so the frame comes from a little way in.
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = Math.min(duration / 10, VIDEO_FRAME_MAX_SECONDS);
    };
    video.onseeked = async () => {
        try {
            const scale = Math.min(1, VIDEO_FRAME_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
            const canvas = new OffscreenCanvas(Math.max(1, Math.round(video.videoWidth * scale)),
                            Math.max(1, Math.round(video.videoHeight * scale)));
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
            finish(new File([frame], 'preview.jpg', { type: 'image/jpeg' }));
        } catch {
            finish();
        }
    };
    video.src = url;
});
