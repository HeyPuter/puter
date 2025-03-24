/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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

// METADATA // {"ai-commented":{"service":"claude"}}
const BaseService = require("../../services/BaseService");


/**
* Service class that manages AI interface registrations and configurations.
* Handles registration of various AI services including OCR, chat completion,
* image generation, and text-to-speech interfaces. Each interface defines
* its available methods, parameters, and expected results.
* @extends BaseService
*/
class AIInterfaceService extends BaseService {
    /**
    * Service class for managing AI interface registrations and configurations.
    * Extends the base service to provide AI-related interface management.
    * Handles registration of OCR, chat completion, image generation, and TTS interfaces.
    */
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('puter-ocr', {
            description: 'Optical character recognition',
            methods: {
                recognize: {
                    description: 'Recognize text in an image or document.',
                    parameters: {
                        source: {
                            type: 'file',
                        },
                    },
                    result: {
                        type: {
                            $: 'stream',
                            content_type: 'image',
                        }
                    },
                },
            }
        });

        col_interfaces.set('puter-chat-completion', {
            description: 'Chatbot.',
            methods: {
                models: {
                    description: 'List supported models and their details.',
                    result: { type: 'json' },
                    parameters: {},
                },
                list: {
                    description: 'List supported models',
                    result: { type: 'json' },
                    parameters: {},
                },
                complete: {
                    description: 'Get completions for a chat log.',
                    parameters: {
                        messages: { type: 'json' },
                        tools: { type: 'json' },
                        vision: { type: 'flag' },
                        stream: { type: 'flag' },
                        response: { type: 'json' },
                        model: { type: 'string' },
                        temperature: { type: 'number' },
                        max_tokens: { type: 'number' },
                    },
                    result: { type: 'json' },
                }
            }
        });

        col_interfaces.set('puter-image-generation', {
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
        });

        col_interfaces.set('puter-tts', {
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
        })
    }
}

module.exports = {
    AIInterfaceService
};
