/**
 * Represents the outcome of a task that might fail or succeed.
 */
export class OutcomeObject<T> {
    /**
     * If the task was not successful, this will be the message a user
     * sees.
     */
    userMessage = null;

    /**
     * If the task was not successful, this will be the i18n key for
     * the message a user sees.
     */
    userMessageKey = null;

    /**
     * If the task was not successful, this will be values used for
     * a message template that is identified using `userMessageKey`.
     */
    userMessageFields = {};

    /**
     * If the task being performed failed
     */
    failed = false;

    messages: Record<string, unknown>[] = [];
    fields = {};

    /**
     * Whether the task being performed has ended,
     * either successfully or unsuccessfully.
     */
    ended = false;

    infoObject: T;

    constructor (infoObject: T) {
        this.failed = true;
        this.userMessageFields = {};
        this.infoObject = infoObject;
    }
    log (text, fields?: unknown) {
        this.messages.push({ text, fields });
    }

    get succeeded () {
        return this.ended && !this.failed;
    }

    /**
     * Records a failure message.
     * Returns the outcome object for chaining with a return statement.
     *
     * @example
     * return outcome.fail(
     *     'User already exists',
     *     'signup.user_already_exists',
     *     { username: 'john_doe' }
     * );
     *
     * @param {*} message - message the user sees without i18n
     * @param {*} i18nKey - i18n key for the message
     * @param {*} fields - fields for i18n-key-identified template
     */
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
