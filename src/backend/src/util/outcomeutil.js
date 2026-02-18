export class OutcomeObject {
    userMessage = null;
    userMessageKey = null;
    userMessageFields = {};
    failed = false;
    messages = [];
    fields = {};
    ended = false;
    infoObject;
    get succeeded () {
        return this.ended && !this.failed;
    }
    constructor (infoObject) {
        this.failed = true;
        this.userMessageFields = {};
        this.infoObject = infoObject;
    }
    log (text, fields) {
        this.messages.push({ text, fields });
    }
    fail (message, i18nKey, fields = {}) {
        this.userMessage = message;
        this.userMessageKey = i18nKey;
        this.userMessageFields = fields;
        this.ended = true;
        this.failed = true;
        return this;
    }
    success () {
        this.ended = true;
        this.failed = false;
        return this;
    }
}
//# sourceMappingURL=outcomeutil.js.map