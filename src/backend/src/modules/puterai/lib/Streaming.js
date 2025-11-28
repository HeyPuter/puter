class AIChatConstructStream {
    constructor (chatStream, params) {
        this.chatStream = chatStream;
        if ( this._start ) this._start(params);
    }
    end () {
    }
}

class AIChatTextStream extends AIChatConstructStream {
    addText (text, extra_content) {
        const json = JSON.stringify({
            type: 'text',
            text,
            ...(extra_content ? { extra_content } : {}),
        });
        this.chatStream.stream.write(`${json }\n`);
    }

    addReasoning (reasoning) {
        const json = JSON.stringify({
            type: 'reasoning', reasoning,
        });
        this.chatStream.stream.write(`${json }\n`);
    }

    addExtraContent (extra_content) {
        const json = JSON.stringify({
            type: 'extra_content',
            extra_content,
        });
        this.chatStream.stream.write(`${json }\n`);
    }
}

class AIChatToolUseStream extends AIChatConstructStream {
    _start (params) {
        this.contentBlock = params;
        this.buffer = '';
    }
    addPartialJSON (partial_json) {
        this.buffer += partial_json;
    }
    end () {
        if ( this.buffer.trim() === '' ) {
            this.buffer = '{}';
        }
        if ( process.env.DEBUG ) console.log('BUFFER BEING PARSED', this.buffer);
        const str = JSON.stringify({
            type: 'tool_use',
            ...this.contentBlock,
            input: JSON.parse(this.buffer),
            ...( !this.contentBlock.text ? { text: '' } : {}),
        });
        this.chatStream.stream.write(`${str }\n`);
    }
}

class AIChatMessageStream extends AIChatConstructStream {
    contentBlock ({ type, ...params }) {
        if ( type === 'tool_use' ) {
            return new AIChatToolUseStream(this.chatStream, params);
        }
        if ( type === 'text' ) {
            return new AIChatTextStream(this.chatStream, params);
        }
        throw new Error(`Unknown content block type: ${type}`);
    }
}

class AIChatStream {
    constructor ({ stream }) {
        this.stream = stream;
    }

    end () {
        this.stream.end();
    }

    message () {
        return new AIChatMessageStream(this);
    }
}

module.exports = class Streaming {
    static AIChatStream = AIChatStream;
};
