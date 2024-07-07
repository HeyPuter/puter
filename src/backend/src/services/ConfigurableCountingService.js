/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
var crypto = require('crypto')
const BaseService = require("./BaseService");
const { Context } = require("../util/context");
const { DB_WRITE } = require('./database/consts');

const hash = v => {
    var sum = crypto.createHash('sha1');
    sum.update('foo');
    return sum.digest();
}

class ConfigurableCountingService extends BaseService {
    static counting_types = {
        gpt: {
            category: [
                {
                    name: 'model',
                    type: 'string',
                }
            ],
            values: [
                {
                    name: 'input_tokens',
                    type: 'uint',
                },
                {
                    name: 'output_tokens',
                    type: 'uint',
                }
            ]
        },
        dalle: {
            category: [
                {
                    name: 'model',
                    type: 'string',
                },
                {
                    name: 'quality',
                    type: 'string',
                },
                {
                    name: 'resolution',
                    type: 'string',
                }
            ],
        }
    };

    static sql_columns = {
        uint: [
            'value_uint_1',
            'value_uint_2',
            'value_uint_3',
        ],
    }

    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'counting');
    }

    async increment ({ service_name, service_type, values }) {
        values = values ? {...values} : {};

        const now = new Date();
        const year = now.getUTCFullYear();
        const month = now.getUTCMonth() + 1;

        const counting_type = this.constructor.counting_types[service_type];
        if ( ! counting_type ) {
            throw new Error(`unknown counting type ${service_type}`);
        }

        const available_columns = {};
        for ( const k in this.constructor.sql_columns ) {
            available_columns[k] = [...this.constructor.sql_columns[k]];
        }

        const custom_col_names = counting_type.values.map((value, index) => {
            const column = available_columns[value.type].shift();
            if ( ! column ) {
                // TODO: this could be an init check on all the available service types
                throw new Error(`no more available columns for type ${value.type}`);
            }
            return column;
        });

        const custom_col_values = counting_type.values.map((value, index) => {
            return values[value.name];
        });

        // `pricing_category` is a JSON field. Keys from `values` used for
        // the pricing category will be removed from ths `values` object
        const pricing_category = {};
        for ( const category of counting_type.category ) {
            pricing_category[category.name] = values[category.name];
            delete values[category.name];
        }

        // `JSON.stringify` cannot be used here because it does not sort
        // the keys.
        const pricing_category_str = counting_type.category.map((category) => {
            return `${category.name}:${pricing_category[category.name]}`;
        }).join(',');

        const pricing_category_hash = hash(pricing_category_str);

        const actor = Context.get('actor');
        const actor_key = actor.uid;

        const required_data = {
            year, month, service_name, service_type,
            actor_key, pricing_category_hash,
            pricing_category: JSON.stringify(pricing_category),
        };

        const sql =
            `INSERT INTO monthly_usage_counts (${
                Object.keys(required_data).join(', ')
            }, count, ${
                custom_col_names.join(', ')
            }) ` +
            `VALUES (${
                Object.keys(required_data).map(() => '?').join(', ')
            }, 1, ${custom_col_values.map(() => '?').join(', ')}) ` +
            `ON DUPLICATE KEY UPDATE count = count + 1${
                custom_col_names.length > 0 ? ', ' : ''
            } ${
                custom_col_names.map((name) => `${name} = ${name} + ?`).join(', ')
            }`;

        const value_array = [
            ...Object.values(required_data),
            ...custom_col_values,
            ...custom_col_values,
        ]

        console.log('SQL QUERY', sql, value_array);

        await this.db.write(sql, value_array);
    }
}

module.exports = {
    ConfigurableCountingService,
};
