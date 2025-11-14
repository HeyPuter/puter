import { safeHasOwnProperty } from '../lib/objectfn.js';
import BaseOperation from './BaseOperation.js';

export default class extends BaseOperation {
    static requiredForCreate = [
        'uuid',
        'parent_uid',
    ];

    static allowedForCreate = [
        ...this.requiredForCreate,
        'name',
        'user_id',
        'is_dir',
        'created',
        'modified',
        'immutable',
        'shortcut_to',
        'is_shortcut',
        'metadata',
        'bucket',
        'bucket_region',
        'thumbnail',
        'accessed',
        'size',
        'symlink_path',
        'is_symlink',
        'associated_app_id',
        'path',
    ];

    constructor (entry) {
        super();
        const requiredForCreate = this.constructor.requiredForCreate;
        const allowedForCreate = this.constructor.allowedForCreate;

        {
            const sanitized_entry = {};
            for ( const k of allowedForCreate ) {
                if ( safeHasOwnProperty(entry, k) ) {
                    sanitized_entry[k] = entry[k];
                }
            }
            entry = sanitized_entry;
        }

        for ( const k of requiredForCreate ) {
            console.log('checking for key', entry, k, typeof entry[k], entry[k], safeHasOwnProperty(entry, k));
            if ( ! safeHasOwnProperty(entry, k) ) {
                throw new Error(`Missing required property: ${k}`);
            }
        }

        this.entry = entry;
    }

    getStatement () {
        const fields = Object.keys(this.entry);
        const statement = 'INSERT INTO fsentries ' +
            `(${fields.join(', ')}) ` +
            `VALUES (${fields.map(() => '?').join(', ')})`;
        const values = fields.map(k => this.entry[k]);
        return { statement, values };
    }

    apply (answer) {
        answer.entry = { ...this.entry };
    }

    get uuid () {
        return this.entry.uuid;
    }
};
