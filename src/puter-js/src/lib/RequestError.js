export class RequestError extends Error {
    constructor (message) {
        super(message);
        this.name = 'RequestError'; // thanks minifier
    }
}
