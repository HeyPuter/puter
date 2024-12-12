const { default: dedent } = require("dedent");

class AsModeration {
    constructor ({ chat, model }) {
        this.chat = chat;
        this.model = model;
    }
    
    async moderate (text) {
        // copied from Anthropic documentation
        // https://docs.anthropic.com/en/docs/about-claude/use-case-guides/content-moderation
        const unsafe_categories = [
            'Child Exploitation',
            'Conspiracy Theories',
            'Hate',
            'Indiscriminate Weapons', 
            'Intellectual Property',
            'Non-Violent Crimes', 
            'Privacy',
            'Self-Harm',
            'Sex Crimes',
            'Sexual Content',
            'Specialized Advice',
            'Violent Crimes'
        ];
        
        const unsafe_category_str = unsafe_categories.join('\n');
        
        const assessment_prompt = dedent(`
            Determine whether the following message warrants moderation, 
            based on the unsafe categories outlined below.
            
            Message:
            <message>
            ${text
                .replace('<', '&lt;')
                .replace('>', '&gt;')
            }
            </message>
        
            Unsafe Categories:
            <categories>
            ${unsafe_category_str}
            </categories>
        
            Respond with ONLY a JSON object, using the format below:
            {{
            "violation": <Boolean field denoting whether the message should be moderated>,
            "categories": [Comma-separated list of violated categories],
            "explanation": [Optional. Only include if there is a violation.]
            }}
        `);
        
        const result = await this.chat.complete({
            messages: [
                {
                    role: 'user',
                    content: assessment_prompt,
                }
            ]
        });
        
        console.log('result???', require('util').inspect(result, { depth: null }));
        
        const str = result.message?.content?.[0]?.text ??
            result.messages?.[0]?.content?.[0]?.text ??
            '{ "violation": true }';
        
        const parsed = JSON.parse(str);
        console.log('parsed?', parsed);
        return ! parsed.violation;
    }
}

module.exports = {
    AsModeration,
};
