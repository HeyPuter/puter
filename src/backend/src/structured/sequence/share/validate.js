/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const APIError = require("../../../api/APIError");
const { Sequence } = require("../../../codex/Sequence");
const { whatis } = require("../../../util/langutil");

/*
    This code is optimized for editors supporting folding.
    Fold at Level 2 to conveniently browse sequence steps.
    Fold at Level 3 after opening an inner-sequence.

    If you're using VSCode {
        typically "Ctrl+K, Ctrl+2" or "⌘K, ⌘2";
        to revert "Ctrl+K, Ctrl+J" or "⌘K, ⌘J";
        https://stackoverflow.com/questions/30067767
    }
*/

module.exports = new Sequence({
    name: 'validate request',
}, [
    function validate_metadata(a) {
        const req = a.get('req');
        const metadata = req.body.metadata;

        if ( ! metadata ) return;

        if ( typeof metadata !== 'object' ) {
            throw APIError.create('field_invalid', null, {
                key: 'metadata',
                expected: 'object',
                got: whatis(metadata),
            });
        }

        const MAX_KEYS = 20;
        const MAX_STRING = 255;
        const MAX_MESSAGE_STRING = 10 * 1024;

        if ( Object.keys(metadata).length > MAX_KEYS ) {
            throw APIError.create('field_invalid', null, {
                key: 'metadata',
                expected: `at most ${MAX_KEYS} keys`,
                got: `${Object.keys(metadata).length} keys`,
            });
        }

        for ( const key in metadata ) {
            const value = metadata[key];
            if ( typeof value !== 'string' && typeof value !== 'number' ) {
                throw APIError.create('field_invalid', null, {
                    key: `metadata.${key}`,
                    expected: 'string or number',
                    got: whatis(value),
                });
            }
            if ( key === 'message' ) {
                if ( typeof value !== 'string' ) {
                    throw APIError.create('field_invalid', null, {
                        key: `metadata.${key}`,
                        expected: 'string',
                        got: whatis(value),
                    });
                }
                if ( value.length > MAX_MESSAGE_STRING ) {
                    throw APIError.create('field_invalid', null, {
                        key: `metadata.${key}`,
                        expected: `at most ${MAX_MESSAGE_STRING} characters`,
                        got: `${value.length} characters`,
                    });
                }
                continue;
            }
            if ( typeof value === 'string' && value.length > MAX_STRING ) {
                throw APIError.create('field_invalid', null, {
                    key: `metadata.${key}`,
                    expected: `at most ${MAX_STRING} characters`,
                    got: `${value.length} characters`,
                });
            }
        }
    },
    function validate_mode(a) {
        const req = a.get('req');
        const mode = req.body.mode;

        if ( mode === 'strict' ) {
            a.set('strict_mode', true);
            return;
        }
        if ( ! mode || mode === 'best-effort' ) {
            a.set('strict_mode', false);
            return;
        }
        throw APIError.create('field_invalid', null, {
            key: 'mode',
            expected: '`strict`, `best-effort`, or undefined',
        });
    },
    function validate_recipients(a) {
        const req = a.get('req');
        let recipients = req.body.recipients;

        // A string can be adapted to an array of one string
        if ( typeof recipients === 'string' ) {
            recipients = [recipients];
        }
        // Must be an array
        if ( ! Array.isArray(recipients) ) {
            throw APIError.create('field_invalid', null, {
                key: 'recipients',
                expected: 'array or string',
                got: typeof recipients,
            });
        }
        // At least one recipient
        if ( recipients.length < 1 ) {
            throw APIError.create('field_invalid', null, {
                key: 'recipients',
                expected: 'at least one',
                got: 'none',
            });
        }
        a.set('req_recipients', recipients);
    },
    function validate_shares(a) {
        const req = a.get('req');
        let shares = req.body.shares;

        if ( ! Array.isArray(shares) ) {
            shares = [shares];
        }

        // At least one share
        if ( shares.length < 1 ) {
            throw APIError.create('field_invalid', null, {
                key: 'shares',
                expected: 'at least one',
                got: 'none',
            });
        }

        a.set('req_shares', shares);
    },
    function return_state(a) {
        return a;
    },
]);
