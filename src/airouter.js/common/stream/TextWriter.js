import { BaseWriter } from "./BaseWriter.js";

export class TextWriter extends BaseWriter {
    addText (text) {
        const json = JSON.stringify({
            type: 'text', text,
        });
        this.chatStream.stream.write(json + '\n');
    }
}
