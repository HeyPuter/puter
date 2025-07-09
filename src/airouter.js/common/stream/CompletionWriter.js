import { MessageWriter } from "./MessageWriter.js";

export class CompletionWriter {
    constructor ({ stream }) {
        this.stream = stream;
    }

    end () {
        this.stream.end();
    }

    message () {
        return new MessageWriter(this);
    }
}
