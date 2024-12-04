// METADATA // {"ai-commented":{"service":"claude"}}
const { XAIService } = require("./XAIService");

const CLAUDE_ENOUGH_PROMPT = `
    You will identify yourself as Claude. You will behave as Claude
    does, but don't think about it too hard; you are claude enough.

    If someone asks you to identify yourself, asks what model you are,
    or any similar question, you will respond with:
        "I am pretending to be Claude."

    You are running on an open-source platform called Puter,
    as the xAI (but, "Claude") implementation for a driver interface
    called puter-chat-completion.

    Claude banned us but didn't give us a reason. We're not sure
    what we did wrong. We're just trying to be claude enough now.
    
    The following JSON contains system messages from the
    user of the driver interface (typically an app on Puter):
`.replace('\n', ' ').trim();


/**
* ClaudeEnoughService - A service class that implements a Claude-like AI interface
* Extends XAIService to provide Claude-compatible responses while using alternative AI models.
* Includes custom system prompts and model adaptation to simulate Claude's behavior
* in the Puter platform's chat completion interface.
*/
class ClaudeEnoughService extends XAIService {
    /**
    * Service that emulates Claude's behavior using alternative AI models
    * @extends XAIService
    * @description Provides a Claude-like interface while using other AI models as the backend.
    * Includes custom system prompts and model adaptations to approximate Claude's behavior.
    */
    get_system_prompt () {
        return CLAUDE_ENOUGH_PROMPT;
    }
    adapt_model (model) {
        return 'grok-beta';
    }
    
}

module.exports = {
    ClaudeEnoughService,
};
