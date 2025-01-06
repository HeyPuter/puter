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
            * Returns a list of available model names including their aliases
            * @returns {Promise<string[]>} Array of model identifiers and their aliases
            * @description Retrieves all available model IDs and their aliases,
            * flattening them into a single array of strings that can be used for model selection
            */
            async list () {
                return ['fake'];
            },

            /**
            * Simulates a chat completion request by generating random Lorem Ipsum text
            * @param {Object} params - The completion parameters
            * @param {Array} params.messages - Array of chat messages (unused in fake implementation)
            * @param {boolean} params.stream - Whether to stream the response (unused in fake implementation)
            * @param {string} params.model - The model to use (unused in fake implementation)
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
                return {
                    "index": 0,
                    message: {
                        "id": "00000000-0000-0000-0000-000000000000",
                        "type": "message",
                        "role": "assistant",
                        "model": "fake",
                        "content": [
                            {
                                "type": "text",
                                "text": model === 'abuse' ? dedent(`
                                        This is a message from ${
                                            this.global_config.origin}. We have detected abuse of our services.
                                        
                                        If you are seeing this on another website, please report it to ${
                                            this.global_config.abuse_email ?? 'hi@puter.com'}
                                    `) : li.generateParagraphs(
                                    Math.floor(Math.random() * 3) + 1
                                )
                            }
                        ],
                        "stop_reason": "end_turn",
                        "stop_sequence": null,
                        "usage": {
                            "input_tokens": 0,
                            "output_tokens": 1
                        }
                    },
                    "usage": {
                        "input_tokens": 0,
                        "output_tokens": 1
                    },
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
