import { BaseWriter } from "./BaseWriter.js";

/**
 * Assign the properties of the override object to the original object,
 * like Object.assign, except properties are ordered so override properties
 * are enumerated first.
 * 
 * @param {*} original 
 * @param {*} override 
 */
const objectAssignTop = (original, override) => {
    let o = {
        ...original,
        ...override,
    };
    o = {
        ...override,
        ...original,
    };
    return o;
}

export class ToolUseWriter extends BaseWriter {
    _start (params) {
        this.contentBlock = params;
        this.buffer = '';
    }
    addPartialJSON (partial_json) {
        this.buffer += partial_json;
    }
    _end () {
        if ( this.buffer.trim() === '' ) {
            this.buffer = '{}';
        }
        if ( process.env.DEBUG ) console.log('BUFFER BEING PARSED', this.buffer);
        const str = JSON.stringify(objectAssignTop({
            ...this.contentBlock,
            input: JSON.parse(this.buffer),
            ...( ! this.contentBlock.text ? { text: "" } : {}),
        }, {
            type: 'tool_use',
        }));
        this.chatStream.stream.write(str + '\n');
    }
}
