// A stand-in for OffscreenCanvas that records what is drawn on it, for tests that run without a browser.

/**
 * `Canvas` replaces OffscreenCanvas. `drawn` collects the canvas size and each call that puts something on it:
 * `fillText` (with the clipping rectangle in force), `fillRect`, `drawImage`, and the line segments of each `stroke`.
 * Positions are in the units the drawing code used. A character measures half its font size wide.
 */
export const createRecordingCanvas = () => {
    const drawn = { width: 0, height: 0, text: [], fills: [], images: [], lines: [] };
    class Canvas {
        constructor (width, height) {
            Object.assign(this, { width, height });
            Object.assign(drawn, { width, height });
        }

        getContext () {
            let pendingRect;
            let clip;
            let from;
            const clips = [];
            const segments = [];
            return {
                font: '',
                fillStyle: '',
                scale () {},
                save () {
                    clips.push(clip);
                },
                restore () {
                    clip = clips.pop();
                },
                beginPath () {
                    segments.length = 0;
                },
                rect (x, y, width, height) {
                    pendingRect = { x, y, width, height };
                },
                clip () {
                    clip = pendingRect;
                },
                moveTo (x, y) {
                    from = { x, y };
                },
                lineTo (x, y) {
                    segments.push({ from, to: { x, y } });
                },
                stroke () {
                    drawn.lines.push(...segments);
                },
                measureText (text) {
                    return { width: [...text].length * parseFloat(/([\d.]+)px/.exec(this.font)[1]) / 2 };
                },
                fillRect (x, y, width, height) {
                    drawn.fills.push({ x, y, width, height, color: this.fillStyle });
                },
                fillText (text, x, y) {
                    drawn.text.push({ text, x, y, font: this.font, color: this.fillStyle, clip });
                },
                drawImage (image, x, y, width, height) {
                    drawn.images.push({ image, x, y, width, height });
                },
            };
        }

        async convertToBlob ({ type }) {
            return new Blob(['page'], { type });
        }
    }
    return { Canvas, drawn };
};

/** The lines of text in `drawn`, top to bottom: each line's words joined, with where its first word starts. */
export const linesOf = (drawn) => {
    const lines = new Map();
    for ( const word of drawn.text ) {
        const line = lines.get(word.y) ?? { words: [], x: word.x, y: word.y, font: word.font, color: word.color };
        line.words.push(word);
        lines.set(word.y, line);
    }
    return [...lines.values()].sort((a, b) => a.y - b.y).map(({ words, ...line }) => ({
        ...line,
        text: words.sort((a, b) => a.x - b.x).map(word => word.text).join(' '),
        x: Math.min(...words.map(word => word.x)),
    }));
};
