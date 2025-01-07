// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
var crypto = require('crypto')
const BaseService = require("./BaseService");
const { Context } = require("../util/context");
const { DB_WRITE } = require('./database/consts');

const hash = v => {
    const sum = crypto.createHash('sha1');
    sum.update(v);
    return sum.digest();
}


/**
* @class ConfigurableCountingService
* @extends BaseService
* @description The ConfigurableCountingService class extends BaseService and is responsible for managing and incrementing
*              configurable counting types for different services.
*              It defines counting types and SQL columns, and provides a method to increment counts based on specific service
*              types and values. This class is used to manage usage counts for various services, ensuring accurate tracking
*              and updating of counts in the database.
*/
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


    /**
    * Initializes the database accessor for the ConfigurableCountingService.
    * This method sets up the database service for writing counting data.
    *
    * @async
    * @function _init
    * @returns {Promise<void>} A promise that resolves when the database connection is established.
    * @memberof ConfigurableCountingService
    */
    async _init () {
        this.db = this.services.get('database').get(DB_WRITE, 'counting');
    }


    /**
    * Increments the count for a given service based on the provided parameters.
    * This method builds an SQL query to update the count and other custom values
    * in the database. It handles different SQL dialects (MySQL and SQLite) and
    * ensures that the pricing category is correctly hashed and stored.
    *
    * @param {Object} params - The parameters for incrementing the count.
    * @param {string} params.service_name - The name of the service.
    * @param {string} params.service_type - The type of the service.
    * @param {Object} params.values - The values to be incremented.
    * @throws {Error} If the service type is unknown or if there are no more available columns.
    * @returns {Promise<void>} A promise that resolves when the count is successfully incremented.
    */
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

        const duplicate_update_part =
            `count = count + 1${
                custom_col_names.length > 0 ? ', ' : ''
            } ${
                custom_col_names.map((name) => `${name} = ${name} + ?`).join(', ')
            }`;

        const identifying_keys = [
            `year`, `month`,
            `service_type`, `service_name`,
            `actor_key`,
            `pricing_category_hash`
        ]

        const sql =
            `INSERT INTO monthly_usage_counts (${
                Object.keys(required_data).join(', ')
            }, count, ${
                custom_col_names.join(', ')
            }) ` +
            `VALUES (${
                Object.keys(required_data).map(() => '?').join(', ')
            }, 1, ${custom_col_values.map(() => '?').join(', ')}) ` +
            this.db.case({
                mysql: 'ON DUPLICATE KEY UPDATE ' + duplicate_update_part,
                sqlite: `ON CONFLICT(${
                    identifying_keys.map(v => `\`${v}\``).join(', ')
                }) DO UPDATE SET ${duplicate_update_part}`,
            })
            ;

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
