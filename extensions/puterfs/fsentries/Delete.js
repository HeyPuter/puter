import BaseOperation from './BaseOperation.js';

export default class extends BaseOperation {
    constructor (uuid) {
        super();
        this.uuid = uuid;
    }

    getStatement () {
        const statement = 'DELETE FROM fsentries WHERE uuid = ? LIMIT 1';
        const values = [this.uuid];
        return { statement, values };
    }

    apply (answer) {
        answer.entry = null;
    }
}
