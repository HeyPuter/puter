// A stand-in for OffscreenCanvas that records what is drawn on it, for tests that run without a browser.

/**
 * `Canvas` replaces OffscreenCanvas. `drawn` collects the canvas size, each `fillText` call and each `drawImage`
 * call, with positions in the units the drawing code used. A character measures half its font size wide.
 */
export const createRecordingCanvas = () => {
    const drawn = { width: 0, height: 0, text: [], images: [] };
    class Canvas {
        constructor (width, height) {
            Object.assign(drawn, { width, height });
        }

        getContext () {
            return {
                font: '',
                fillStyle: '',
                fillRect () {},
                rect () {},
                clip () {},
                scale () {},
                measureText (text) {
                    return { width: [...text].length * parseFloat(/([\d.]+)px/.exec(this.font)[1]) / 2 };
                },
                fillText (text, x, y) {
                    drawn.text.push({ text, x, y, font: this.font, color: this.fillStyle });
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
