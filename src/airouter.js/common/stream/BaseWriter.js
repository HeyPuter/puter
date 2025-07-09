export class BaseWriter {
    constructor (chatStream, params) {
        this.chatStream = chatStream;
        if ( this._start ) this._start(params);
    }
    end () {
        if ( this._end ) this._end();
    }
}
