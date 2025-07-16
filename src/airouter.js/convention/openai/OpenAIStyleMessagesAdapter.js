export class OpenAIStyleMessagesAdapter {
    async adapt_messages (messages) {
        for ( const msg of messages ) {
            if ( ! msg.content ) continue;
            if ( typeof msg.content !== 'object' ) continue;

            const content = msg.content;

            for ( const o of content ) {
                if ( ! o.hasOwnProperty('image_url') ) continue;
                if ( o.type ) continue;
                o.type = 'image_url';
            }

            // coerce tool calls
            let is_tool_call = false;
            for ( let i = content.length - 1 ; i >= 0 ; i-- ) {
                const content_block = content[i];

                if ( content_block.type === 'tool_use' ) {
                    if ( ! msg.hasOwnProperty('tool_calls') ) {
                        msg.tool_calls = [];
                        is_tool_call = true;
                    }
                    msg.tool_calls.push({
                        id: content_block.id,
                        type: 'function',
                        function: {
                            name: content_block.name,
                            arguments: JSON.stringify(content_block.input),
                        }
                    });
                    content.splice(i, 1);
                }
            }

            if ( is_tool_call ) msg.content = null;

            // coerce tool results
            // (we assume multiple tool results were already split into separate messages)
            for ( let i = content.length - 1 ; i >= 0 ; i-- ) {
                const content_block = content[i];
                if ( content_block.type !== 'tool_result' ) continue;
                msg.role = 'tool';
                msg.tool_call_id = content_block.tool_use_id;
                msg.content = content_block.content;
            }
        }
        
        return messages;
    }
}
