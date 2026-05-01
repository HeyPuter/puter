/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

export class AIChatConstructStream {
    constructor(chatStream, params) {
        this.chatStream = chatStream;
        if (this._start) this._start(params);
    }
    end() {}
}

export class AIChatTextStream extends AIChatConstructStream {
    addText(text, extra_content) {
        const json = JSON.stringify({
            type: 'text',
            text,
            ...(extra_content ? { extra_content } : {}),
        });
        this.chatStream.stream.write(`${json}\n`);
    }

    addReasoning(reasoning) {
        const json = JSON.stringify({
            type: 'reasoning',
            reasoning,
        });
        this.chatStream.stream.write(`${json}\n`);
    }

    addExtraContent(extra_content) {
        const json = JSON.stringify({
            type: 'extra_content',
            extra_content,
        });
        this.chatStream.stream.write(`${json}\n`);
    }
}

export class AIChatToolUseStream extends AIChatConstructStream {
    _start(params) {
        this.contentBlock = params;
        this.buffer = '';
    }
    addPartialJSON(partial_json) {
        this.buffer += partial_json;
    }
    end() {
        if (this.buffer.trim() === '') {
            this.buffer = '{}';
        }
        if (process.env.DEBUG) console.log('BUFFER BEING PARSED', this.buffer);
        const str = JSON.stringify({
            type: 'tool_use',
            ...this.contentBlock,
            input: JSON.parse(this.buffer),
            ...(!this.contentBlock.text ? { text: '' } : {}),
        });
        this.chatStream.stream.write(`${str}\n`);
    }
}

export class AIChatMessageStream extends AIChatConstructStream {
    contentBlock({ type, ...params }) {
        if (type === 'tool_use') {
            return new AIChatToolUseStream(this.chatStream, params);
        }
        if (type === 'text') {
            return new AIChatTextStream(this.chatStream, params);
        }
        throw new Error(`Unknown content block type: ${type}`);
    }
}

export class AIChatStream {
    stream;
    constructor({ stream }) {
        this.stream = stream;
    }

    end(/** @type {Record<string,number>} */ usage) {
        this.stream.write(
            `${JSON.stringify({
                type: 'usage',
                usage,
            })}\n`,
        );
        this.stream.end();
    }

    message() {
        return new AIChatMessageStream(this);
    }
    write(...args) {
        return this.stream.write(...args);
    }
}

export default class Streaming {
    static AIChatStream = AIChatStream;
}
