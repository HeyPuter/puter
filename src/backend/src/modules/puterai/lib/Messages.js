const { whatis } = require("../../../util/langutil");

module.exports = class Messages {
    static normalize_single_message (message, params = {}) {
        params = Object.assign({
            role: 'user',
        }, params);

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
                return message;
            }
            throw new Error(`each message must have a 'content' property`);
        }
        if ( whatis(message.content) !== 'array' ) {
            message.content = [message.content];
        }
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
            if ( ! message.content[i].type ) {
                message.content[i].type = 'text';
            }
        }

        console.log('???', message)
        return message;
    }
    static normalize_messages (messages, params = {}) {
        for ( let i=0 ; i < messages.length ; i++ ) {
            messages[i] = this.normalize_single_message(messages[i], params);
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
    }

    static extract_and_remove_system_messages (messages) {
        let system_messages = [];
        let new_messages = [];
        for ( let i=0 ; i < messages.length ; i++ ) {
            if ( messages[i].role === 'system' ) {
                system_messages.push(messages[i]);
            } else {
                new_messages.push(messages[i]);
            }
        }
        return [system_messages, new_messages];
    }

    static extract_text (messages) {
        return messages.map(m => {
            if ( whatis(m) === 'string' ) {
                return m;
            }
            if ( whatis(m) !== 'object' ) {
                return '';
            }
            if ( whatis(m.content) === 'array' ) {
                return m.content.map(c => c.text).join(' ');
            }
            if ( whatis(m.content) === 'string' ) {
                return m.content;
            } else {
                const is_text_type = m.content.type === 'text' ||
                    ! m.content.hasOwnProperty('type');
                if ( is_text_type ) {
                    if ( whatis(m.content.text) !== 'string' ) {
                        throw new Error('text content must be a string');
                    }
                    return m.content.text;
                }
                return '';
            }
        }).join(' ');
    }
}