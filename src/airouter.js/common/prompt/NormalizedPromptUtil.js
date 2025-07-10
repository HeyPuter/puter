import { whatis } from "../util/lang.js";

/**
 * NormalizedPromptUtil provides utility functions that can be called on
 * normalized arrays of "chat" messages.
 */
export class NormalizedPromptUtil {
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
}