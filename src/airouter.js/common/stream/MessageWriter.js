import { BaseWriter } from "./BaseWriter.js";
import { TextWriter } from "./TextWriter.js";
import { ToolUseWriter } from "./ToolUseWriter.js";

export class MessageWriter extends BaseWriter {
    contentBlock ({ type, ...params }) {
        if ( type === 'tool_use' ) {
            return new ToolUseWriter(this.chatStream, params);
        }
        if ( type === 'text' ) {
            return new TextWriter(this.chatStream, params);
        }
        throw new Error(`Unknown content block type: ${type}`);
    }
}
