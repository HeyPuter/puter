import { safeHasOwnProperty } from '../lib/objectfn.js';
import BaseOperation from './BaseOperation.js';

export default class extends BaseOperation {
    static allowedForUpdate = [
        'name',
        'parent_uid',
        'user_id',
        'modified',
        'shortcut_to',
        'metadata',
        'thumbnail',
        'size',
        'path',
    ];

    constructor (uuid, entry) {
        super();
        const allowedForUpdate = this.constructor.allowedForUpdate;

        {
            const sanitized_entry = {};
            for ( const k of allowedForUpdate ) {
                if ( safeHasOwnProperty(entry, k) ) {
                    sanitized_entry[k] = entry[k];
                }
            }
            entry = sanitized_entry;
        }

        this.uuid = uuid;
        this.entry = entry;
    }

    getStatement () {
        const fields = Object.keys(this.entry);
        const statement = 'UPDATE fsentries SET ' +
            `${fields.map(k => `${k} = ?`).join(', ')} ` +
            'WHERE uuid = ? LIMIT 1';
        const values = fields.map(k => this.entry[k]);
        values.push(this.uuid);
        return { statement, values };
    }

    apply (answer) {
        if ( ! answer.entry ) {
            answer.is_diff = true;
            answer.entry = {};
        }
        Object.assign(answer.entry, this.entry);
    }
};
