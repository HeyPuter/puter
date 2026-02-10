
/**
     * Normalizes a single message into a standardized format with role and content array.
     * Converts string messages to objects, ensures content is an array of content blocks,
     * transforms tool_calls into tool_use content blocks, and coerces content items into objects.
     *
     * @param {string|Object} message - The message to normalize, either a string or message object
     * @param {Object} params - Optional parameters including default role
     * @returns {Object} Normalized message with role and content array
     * @throws {Error} If message is not a string or object
     * @throws {Error} If message has no content property and no tool_calls
     * @throws {Error} If any content item is not a string or object
     */
export const normalize_single_message = (message, params = {}) => {
    params = Object.assign({
        role: 'user',
    }, params);

    if ( typeof message === 'string' ) {
        message = {
            content: [message],
        };
    }
    if ( !message || typeof message !== 'object' || Array.isArray(message) ) {
        throw new Error('each message must be a string or object');
    }
    if ( ! message.role ) {
        message.role = params.role;
    }
    if ( !message.content && message.content !== '' ) {
        if ( message.tool_calls ) {
            message.content = [];
            for ( let i = 0 ; i < message.tool_calls.length ; i++ ) {
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
            throw new Error('each message must have a \'content\' property');
        }
    }

    // Normalize OpenAI-style tool results into internal tool_result blocks
    if ( message.role === 'tool' ) {
        const tool_use_id = message.tool_call_id || message.tool_use_id || message.id;
        const tool_content = message.content;
        message.tool_use_id = tool_use_id;
        message.content = [
            {
                type: 'tool_result',
                tool_use_id,
                content: typeof tool_content === 'string'
                    ? tool_content
                    : JSON.stringify(tool_content ?? {}),
            },
        ];
    }
    if ( ! Array.isArray(message.content) ) {
        message.content = [message.content];
    }
    // Coerce each content block into an object
    for ( let i = 0 ; i < message.content.length ; i++ ) {
        if ( typeof message.content[i] === 'string' ) {
            message.content[i] = {
                type: 'text',
                text: message.content[i],
            };
        }
        if ( !message || typeof message.content[i] !== 'object' || Array.isArray(message.content[i]) ) {
            throw new Error('each message content item must be a string or object');
        }
        if ( typeof message.content[i].text === 'string' && !message.content[i].type ) {
            message.content[i].type = 'text';
        }
    }

    // Remove "text" properties from content blocks with type=tool_result
    for ( let i = 0 ; i < message.content.length ; i++ ) {
        if ( message.content[i].type !== 'tool_use' ) {
            continue;
        }
        if ( Object.prototype.hasOwnProperty.call(message.content[i], 'text') ) {
            delete message.content[i].text;
        }
    }

    return message;
};

/**
     * Normalizes an array of messages by applying normalize_single_message to each,
     * then splits messages with multiple content blocks into separate messages,
     * and finally merges consecutive messages from the same role.
     *
     * @param {Array} messages - Array of messages to normalize
     * @param {Object} params - Optional parameters passed to normalize_single_message
     * @returns {Array} Normalized and merged array of messages
     */
export const normalize_messages = (messages, params = {}) => {
    for ( let i = 0 ; i < messages.length ; i++ ) {
        messages[i] = normalize_single_message(messages[i], params);
    }

    // Split messages with multiple content blocks into separate messages.
    // Keep assistant tool_use blocks together to preserve OpenAI tool-call ordering.
    // TODO: unit test this
    messages = [...messages];
    for ( let i = 0 ; i < messages.length ; i++ ) {
        let message = messages[i];
        let separated_messages = [];
        const has_tool_use = message.role === 'assistant' &&
            message.content?.some(c => c?.type === 'tool_use');
        if ( has_tool_use ) {
            separated_messages.push(message);
            messages.splice(i, 1, ...separated_messages);
            continue;
        }
        for ( let j = 0 ; j < message.content.length ; j++ ) {
            separated_messages.push({
                ...message,
                content: [message.content[j]],
            });
        }
        messages.splice(i, 1, ...separated_messages);
    }

    // If multiple messages are from the same role, merge them
    // but avoid merging tool_use/tool_result messages, since order matters
    const hasToolContent = (message) => {
        if ( !message || !Array.isArray(message.content) ) return false;
        return message.content.some((part) =>
            part && (part.type === 'tool_use' || part.type === 'tool_result'));
    };
    let merged_messages = [];
    let current_role = null;
    for ( let i = 0 ; i < messages.length ; i++ ) {
        const can_merge = current_role === messages[i].role &&
            !hasToolContent(messages[i]) &&
            !hasToolContent(merged_messages[merged_messages.length - 1]);
        if ( can_merge ) {
            merged_messages[merged_messages.length - 1].content.push(...messages[i].content);
        } else {
            merged_messages.push(messages[i]);
            current_role = messages[i].role;
        }
    }

    return merged_messages;
};

/**
     * Separates system messages from other messages in the array.
     *
     * @param {Array} messages - Array of messages to process
     * @returns {Array} Tuple containing [system_messages, non_system_messages]
     */
export const extract_and_remove_system_messages = (messages) => {
    let system_messages = [];
    let new_messages = [];
    for ( let i = 0 ; i < messages.length ; i++ ) {
        if ( messages[i].role === 'system' ) {
            system_messages.push(messages[i]);
        } else {
            new_messages.push(messages[i]);
        }
    }
    return [system_messages, new_messages];
};

/**
     * Extracts all text content from messages, handling various message formats.
     * Processes strings, objects with content arrays, and nested content structures,
     * joining all text with spaces.
     *
     * @param {Array} messages - Array of messages to extract text from
     * @returns {string} Concatenated text content from all messages
     * @throws {Error} If text content is not a string
     */
export const extract_text = (messages) => {
    return messages.map(m => {
        if ( typeof m === 'string' ) {
            return m;
        }
        if ( !m || typeof m !== 'object' || Array.isArray(m) ) {
            return '';
        }
        if ( Array.isArray(m.content) ) {
            return m.content.map(c => c.text).join(' ');
        }
        if ( typeof m.content === 'string' ) {
            return m.content;
        } else {
            const is_text_type = m.content.type === 'text' ||
                !Object.prototype.hasOwnProperty.call(m.content, 'type');
            if ( is_text_type ) {
                if ( typeof m.content.text !== 'string' ) {
                    throw new Error('text content must be a string');
                }
                return m.content.text;
            }
            return '';
        }
    }).join(' ');
};
