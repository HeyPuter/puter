// METADATA // {"ai-commented":{"service":"xai"}}
/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const ENTITY_STORAGE_INTERFACE = {
    methods: {
        create: {
            parameters: {
                object: {
                    type: 'json',
                    subtype: 'object',
                    required: true,
                },
                options: { type: 'json' },
            }
        },
        read: {
            parameters: {
                uid: { type: 'string' },
                id: { type: 'json' },
            }
        },
        select: {
            parameters: {
                predicate: { type: 'json' },
                offset: { type: 'number' },
                limit: { type: 'number' },
            }
        },
        update: {
            parameters: {
                id: { type: 'json' },
                object: {
                    type: 'json',
                    subtype: 'object',
                    required: true,
                },
                options: { type: 'json' },
            }
        },
        upsert: {
            parameters: {
                id: { type: 'json' },
                object: {
                    type: 'json',
                    subtype: 'object',
                    required: true,
                },
                options: { type: 'json' },
            }
        },
        delete: {
            parameters: {
                uid: { type: 'string' },
                id: { type: 'json' },
            }
        },
    },
}

module.exports = {
    'hello-world': {
        description: 'A simple driver that returns a greeting.',
        methods: {
            greet: {
                description: 'Returns a greeting.',
                parameters: {
                    subject: {
                        type: 'string',
                        optional: true,
                    },
                },
                result: { type: 'string' },
            }
        }
    },
    // Note: these are all prefixed with 'puter-' to avoid name collisions
    // with possible future support for user-contributed driver interfaces.
    'puter-ocr': {
        description: 'Optical character recognition.',
        methods: {
            recognize: {
                description: 'Recognize text in an image or document.',
                parameters:  {
                    source: {
                        type: 'file',
                    },
                },
                result: { type: 'image' },
            },
        },
    },
    'puter-kvstore': {
        description: 'A simple key-value store.',
        methods: {
            get: {
                description: 'Get a value by key.',
                parameters: {
                    key: { type: 'string', required: true },
                    app_uid: { type: 'string', optional: true },
                },
                result: { type: 'json' },
            },
            set: {
                description: 'Set a value by key.',
                parameters: {
                    key: { type: 'string', required: true, },
                    value: { type: 'json' },
                    app_uid: { type: 'string', optional: true },
                },
                result: { type: 'void' },
            },
            del: {
                description: 'Delete a value by key.',
                parameters: {
                    key: { type: 'string' },
                    app_uid: { type: 'string', optional: true },
                },
                result: { type: 'void' },
            },
            list: {
                description: 'List all key-value pairs.',
                parameters: {
                    as: {
                        type: 'string',
                    },
                    app_uid: { type: 'string', optional: true },
                },
                result: { type: 'array' },
            },
            flush: {
                description: 'Delete all key-value pairs.',
                parameters: {},
                result: { type: 'void' },
            },
            incr: {
                description: 'Increment a value by key.',
                parameters: {
                    key: { type: 'string', required: true, },
                    amount: { type: 'number' },
                    app_uid: { type: 'string', optional: true },
                },
                result: { type: 'number' },
            },
            decr: {
                description: 'Increment a value by key.',
                parameters: {
                    key: { type: 'string', required: true, },
                    amount: { type: 'number' },
                    app_uid: { type: 'string', optional: true },
                },
                result: { type: 'number' },
            },
            /*
            expireat: {
                description: 'Set a key\'s time-to-live.',
                parameters: {
                    key: { type: 'string', required: true, },
                    timestamp: { type: 'number', required: true, },
                    app_uid: { type: 'string', optional: true },
                },
            },
            expire: {
                description: 'Set a key\'s time-to-live.',
                parameters: {
                    key: { type: 'string', required: true, },
                    ttl: { type: 'number', required: true, },
                    app_uid: { type: 'string', optional: true },
                },
            }
            */
        }
    },
    'puter-chat-completion': {
        description: 'Chatbot.',
        methods: {
            complete: {
                description: 'Get completions for a chat log.',
                parameters: {
                    messages: { type: 'json' },
                    vision: { type: 'flag' },
                },
                result: { type: 'json' }
            }
        }
    },
    'puter-image-generation': {
        description: 'AI Image Generation.',
        methods: {
            generate: {
                description: 'Generate an image from a prompt.',
                parameters: {
                    prompt: { type: 'string' },
                },
                result_choices: [
                    {
                        names: ['image'],
                        type: {
                            $: 'stream',
                            content_type: 'image',
                        }
                    },
                    {
                        names: ['url'],
                        type: {
                            $: 'string:url:web',
                            content_type: 'image',
                        }
                    },
                ],
                result: {
                    description: 'URL of the generated image.',
                    type: 'string'
                }
            }
        }
    },
    'puter-tts': {
        description: 'Text-to-speech.',
        methods: {
            list_voices: {
                description: 'List available voices.',
                parameters: {},
            },
            synthesize: {
                description: 'Synthesize speech from text.',
                parameters: {
                    text: { type: 'string' },
                    voice: { type: 'string' },
                    language: { type: 'string' },
                    ssml: { type: 'flag' },
                },
                result_choices: [
                    {
                        names: ['audio'],
                        type: {
                            $: 'stream',
                            content_type: 'audio',
                        }
                    },
                ]
            },
        }
    },
    'puter-analytics': {
        no_sdk: true,
        description: 'Analytics.',
        methods: {
            create_trace: {
                description: 'Get a trace UID.',
                parameters: {
                    trace_id: { type: 'string', optional: true },
                },
                result: { type: 'string' }
            },
            record: {
                description: 'Record an event.',
                parameters: {
                    trace_id: { type: 'string', optional: true },
                    tags: { type: 'json' },
                    fields: { type: 'json' },
                },
                result: { type: 'void' }
            }
        }
    },
    'puter-apps': {
        ...ENTITY_STORAGE_INTERFACE,
        description: 'Manage a developer\'s apps on Puter.',
    },
    'puter-subdomains': {
        ...ENTITY_STORAGE_INTERFACE,
        description: 'Manage subdomains on Puter.',
    },
    'puter-notifications': {
        ...ENTITY_STORAGE_INTERFACE,
        description: 'Read notifications on Puter.',
    },
    'crud-q': {
        ...ENTITY_STORAGE_INTERFACE,
    },
};
