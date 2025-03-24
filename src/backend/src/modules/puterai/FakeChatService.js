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
const { default: dedent } = require("dedent");
const BaseService = require("../../services/BaseService");


/**
* FakeChatService - A mock implementation of a chat service that extends BaseService.
* Provides fake chat completion responses using Lorem Ipsum text generation.
* Used for testing and development purposes when a real chat service is not needed.
* Implements the 'puter-chat-completion' interface with list() and complete() methods.
*/
class FakeChatService extends BaseService {
    get_default_model () {
        return 'fake';
    }
    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            /**
            * Returns a list of available models with their details
            * @returns {Promise<Object[]>} Array of model details including costs
            * @description Returns detailed information about available models including
            * their costs for input and output tokens
            */
            async models () {
                return [
                    {
                        id: 'fake',
                        aliases: [],
                        cost: {
                            input: 0,
                            output: 0
                        }
                    },
                    {
                        id: 'costly',
                        aliases: [],
                        cost: {
                            input: 1000,  // 1000 microcents per million tokens (0.001 cents per 1000 tokens)
                            output: 2000  // 2000 microcents per million tokens (0.002 cents per 1000 tokens)
                        }
                    },
                    {
                        id: 'abuse',
                        aliases: [],
                        cost: {
                            input: 0,
                            output: 0
                        }
                    }
                ];
            },
            
            /**
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
            async list () {
                return ['fake', 'costly', 'abuse'];
            },

            /**
            * Simulates a chat completion request by generating random Lorem Ipsum text
            * @param {Object} params - The completion parameters
            * @param {Array} params.messages - Array of chat messages
            * @param {boolean} params.stream - Whether to stream the response (unused in fake implementation)
            * @param {string} params.model - The model to use ('fake', 'costly', or 'abuse')
            * @returns {Object} A simulated chat completion response with Lorem Ipsum content
            */
            async complete ({ messages, stream, model }) {
                const { LoremIpsum } = require('lorem-ipsum');
                const li = new LoremIpsum({
                    sentencesPerParagraph: {
                        max: 8,
                        min: 4
                    },
                    wordsPerSentence: {
                        max: 20,
                        min: 12
                    },
                });
                
                // Determine token counts based on messages and model
                const usedModel = model || this.get_default_model();
                
                // For the costly model, simulate actual token counting
                let inputTokens = 0;
                let outputTokens = 0;
                
                if (usedModel === 'costly') {
                    // Simple token estimation: roughly 4 chars per token for input
                    if (messages && messages.length > 0) {
                        for (const message of messages) {
                            if (typeof message.content === 'string') {
                                inputTokens += Math.ceil(message.content.length / 4);
                            } else if (Array.isArray(message.content)) {
                                for (const content of message.content) {
                                    if (content.type === 'text') {
                                        inputTokens += Math.ceil(content.text.length / 4);
                                    }
                                }
                            }
                        }
                    }
                    
                    // Generate random output token count between 50 and 200
                    outputTokens = Math.floor(Math.random() * 150) + 50;
                }
                
                // Generate the response text
                let responseText;
                if (usedModel === 'abuse') {
                    responseText = dedent(`
                        This is a message from ${
                            this.global_config.origin}. We have detected abuse of our services.
                        
                        If you are seeing this on another website, please report it to ${
                            this.global_config.abuse_email ?? 'hi@puter.com'}
                    `);
                } else {
                    // Generate 1-3 paragraphs for both fake and costly models
                    responseText = li.generateParagraphs(
                        Math.floor(Math.random() * 3) + 1
                    );
                }
                
                // Report usage based on model
                const usage = {
                    "input_tokens": usedModel === 'costly' ? inputTokens : 0,
                    "output_tokens": usedModel === 'costly' ? outputTokens : 1
                };
                
                // Emit an event to report usage for the costly model
                if (usedModel === 'costly') {
                    try {
                        const svc_event = this.services.get('event');
                        svc_event.emit('ai.prompt.report-usage', {
                            actor: this.context?.actor,
                            service_used: 'fake-chat',
                            model_used: 'costly',
                            usage: usage
                        });
                    } catch (error) {
                        this.log.error('Failed to report usage', error);
                    }
                }
                
                return {
                    "index": 0,
                    message: {
                        "id": "00000000-0000-0000-0000-000000000000",
                        "type": "message",
                        "role": "assistant",
                        "model": usedModel,
                        "content": [
                            {
                                "type": "text",
                                "text": responseText
                            }
                        ],
                        "stop_reason": "end_turn",
                        "stop_sequence": null,
                        "usage": usage
                    },
                    "usage": usage,
                    "logprobs": null,
                    "finish_reason": "stop"
                }
            }
        }
    }
}

module.exports = {
    FakeChatService,
};
