const BaseService = require("../../services/BaseService");

class FakeChatService extends BaseService {
    static IMPLEMENTS = {
        ['puter-chat-completion']: {
            async list () {
                return ['fake'];
            },
            async complete ({ messages, stream, model }) {
                return {
                    message: {
                        "id": "00000000-0000-0000-0000-000000000000",
                        "type": "message",
                        "role": "assistant",
                        "model": "fake",
                        "content": [
                            {
                                "type": "text",
                                "text": "I am a fake AI, I don't know how to respond to anything."
                            }
                        ],
                        "stop_reason": "end_turn",
                        "stop_sequence": null,
                        "usage": {
                            "input_tokens": 0,
                            "output_tokens": 1
                        }
                    }
                }
            }
        }
    }
}

module.exports = {
    FakeChatService,
};
