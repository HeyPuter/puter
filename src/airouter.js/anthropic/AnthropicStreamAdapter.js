export class AnthropicStreamAdapter {
    static async write_to_stream ({ input, completionWriter, usageWriter }) {
        let message, contentBlock;
        let counts = { input_tokens: 0, output_tokens: 0 };
        for await ( const event of input ) {
            const input_tokens =
                (event?.usage ?? event?.message?.usage)?.input_tokens;
            const output_tokens =
                (event?.usage ?? event?.message?.usage)?.output_tokens;

            if ( input_tokens ) counts.input_tokens += input_tokens;
            if ( output_tokens ) counts.output_tokens += output_tokens;

            if ( event.type === 'message_start' ) {
                message = completionWriter.message();
                continue;
            }
            if ( event.type === 'message_stop' ) {
                message.end();
                message = null;
                continue;
            }

            if ( event.type === 'content_block_start' ) {
                if ( event.content_block.type === 'tool_use' ) {
                    contentBlock = message.contentBlock({
                        type: event.content_block.type,
                        id: event.content_block.id,
                        name: event.content_block.name,
                    });
                    continue;
                }
                contentBlock = message.contentBlock({
                    type: event.content_block.type,
                });
                continue;
            }

            if ( event.type === 'content_block_stop' ) {
                contentBlock.end();
                contentBlock = null;
                continue;
            }

            if ( event.type === 'content_block_delta' ) {
                if ( event.delta.type === 'input_json_delta' ) {
                    contentBlock.addPartialJSON(event.delta.partial_json);
                    continue;
                }
                if ( event.delta.type === 'text_delta' ) {
                    contentBlock.addText(event.delta.text);
                    continue;
                }
            }
        }
        completionWriter.end();
        usageWriter.resolve(counts);
    }
}
