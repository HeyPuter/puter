const BaseService = require("../../services/BaseService");

class FakeChatService extends BaseService {
    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async list () {
                return ['fake'];
            },
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
                                "text": li.generateParagraphs(
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
