import { nou } from "../../common/util/lang.js";

export class OpenAIStyleStreamAdapter {
    static async write_to_stream ({ input, completionWriter, usageWriter }) {
        const message = completionWriter.message();
        let textblock = message.contentBlock({ type: 'text' });
        let toolblock = null;
        let mode = 'text';
        const tool_call_blocks = [];

        let last_usage = null;
        for await ( let chunk of input ) {
            chunk = this.chunk_but_like_actually(chunk);
            if ( process.env.DEBUG ) {
                const delta = chunk?.choices?.[0]?.delta;
                console.log(
                    `AI CHUNK`,
                    chunk,
                    delta && JSON.stringify(delta)
                );
            }
            const chunk_usage = this.index_usage_from_stream_chunk(chunk);
            if ( chunk_usage ) last_usage = chunk_usage;
            if ( chunk.choices.length < 1 ) continue;
            
            const choice = chunk.choices[0];

            if ( ! nou(choice.delta.content) ) {
                if ( mode === 'tool' ) {
                    toolblock.end();
                    mode = 'text';
                    textblock = message.contentBlock({ type: 'text' });
                }
                textblock.addText(choice.delta.content);
                continue;
            }

            const tool_calls = this.index_tool_calls_from_stream_choice(choice);
            if (  ! nou(tool_calls) ) {
                if ( mode === 'text' ) {
                    mode = 'tool';
                    textblock.end();
                }
                for ( const tool_call of tool_calls ) {
                    if ( ! tool_call_blocks[tool_call.index] ) {
                        toolblock = message.contentBlock({
                            type: 'tool_use',
                            id: tool_call.id,
                            name: tool_call.function.name,
                        });
                        tool_call_blocks[tool_call.index] = toolblock;
                    } else {
                        toolblock = tool_call_blocks[tool_call.index];
                    }
                    toolblock.addPartialJSON(tool_call.function.arguments);
                }
            }
        }
        usageWriter.resolve(last_usage);

        if ( mode === 'text' ) textblock.end();
        if ( mode === 'tool' ) toolblock.end();
        message.end();
        completionWriter.end();
    }
    
    /**
     * 
     * @param {*} chunk 
     * @returns 
     */
    static index_usage_from_stream_chunk (chunk) {
        return chunk.usage;
    }
    static chunk_but_like_actually (chunk) {
        return chunk;
    }
    static index_tool_calls_from_stream_choice (choice) {
        return choice.delta.tool_calls;
    }
}
