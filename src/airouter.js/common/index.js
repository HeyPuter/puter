import { NORMALIZED_LLM_MESSAGES, NORMALIZED_LLM_PARAMS, NORMALIZED_SINGLE_MESSAGE, UNIVERSAL_LLM_MESSAGES, UNIVERSAL_LLM_PARAMS, UNIVERSAL_SINGLE_MESSAGE } from "./types.js"
import { whatis } from "./util/lang.js";

export default define => {
    define.howToGet(NORMALIZED_LLM_PARAMS).from(UNIVERSAL_LLM_PARAMS)
    .as(async x => {
        const universal_params = x.get(UNIVERSAL_LLM_PARAMS);
        const normalized_params = {
            ...universal_params,
        };
        
        normalized_params.messages = await x.obtain(NORMALIZED_LLM_MESSAGES);
        
        return normalized_params;
    });

    define.howToGet(NORMALIZED_SINGLE_MESSAGE).from(UNIVERSAL_SINGLE_MESSAGE)
    .as(async x => {
        let message = x.get(UNIVERSAL_SINGLE_MESSAGE);
        
        const params = { role: 'user' };

        if ( typeof message === 'string' ) {
            message = {
                content: [message],
            };
        }
        if ( whatis(message) !== 'object' ) {
            throw new Error('each message must be a string or object');
        }
        if ( ! message.role ) {
            message.role = params.role;
        }
        if ( ! message.content ) {
            if ( message.tool_calls ) {
                message.content = [];
                for ( let i=0 ; i < message.tool_calls.length ; i++ ) {
                    const tool_call = message.tool_calls[i];
                    message.content.push({
                        type: 'tool_use',
                        id: tool_call.id,
                        name: tool_call.function.name,
                        input: tool_call.function.arguments,
                    });
                }
                delete message.tool_calls;
            } else {
                throw new Error(`each message must have a 'content' property`);
            }
        }
        if ( whatis(message.content) !== 'array' ) {
            message.content = [message.content];
        }
        // Coerce each content block into an object
        for ( let i=0 ; i < message.content.length ; i++ ) {
            if ( whatis(message.content[i]) === 'string' ) {
                message.content[i] = {
                    type: 'text',
                    text: message.content[i],
                };
            }
            if ( whatis(message.content[i]) !== 'object' ) {
                throw new Error('each message content item must be a string or object');
            }
            if ( typeof message.content[i].text === 'string' && ! message.content[i].type ) {
                message.content[i].type = 'text';
            }
        }

        // Remove "text" properties from content blocks with type=tool_result
        for ( let i=0 ; i < message.content.length ; i++ ) {
            if ( message.content[i].type !== 'tool_use' ) {
                continue;
            }
            if ( message.content[i].hasOwnProperty('text') ) {
                delete message.content[i].text;
            }
        }

        return message;
    });

    define.howToGet(NORMALIZED_LLM_MESSAGES).from(UNIVERSAL_LLM_MESSAGES)
    .as(async x => {
        let messages = [...x.get(UNIVERSAL_LLM_MESSAGES)];

        for ( let i=0 ; i < messages.length ; i++ ) {
            messages[i] = await x.obtain(NORMALIZED_SINGLE_MESSAGE, {
                [UNIVERSAL_SINGLE_MESSAGE]: messages[i],
            })
        }

        // Split messages with tool_use content into separate messages
        // TODO: unit test this
        messages = [...messages];
        for ( let i=0 ; i < messages.length ; i++ ) {
            let message = messages[i];
            let separated_messages = [];
            for ( let j=0 ; j < message.content.length ; j++ ) {
                if ( message.content[j].type === 'tool_result' ) {
                    separated_messages.push({
                        ...message,
                        content: [message.content[j]],
                    });
                } else {
                    separated_messages.push({
                        ...message,
                        content: [message.content[j]],
                    });
                }
            }
            messages.splice(i, 1, ...separated_messages);
        }

        // If multiple messages are from the same role, merge them
        let merged_messages = [];
        let current_role = null;
        for ( let i=0 ; i < messages.length ; i++ ) {
            if ( current_role === messages[i].role ) {
                merged_messages[merged_messages.length - 1].content.push(...messages[i].content);
            } else {
                merged_messages.push(messages[i]);
                current_role = messages[i].role;
            }
        }

        return merged_messages;
    });
}