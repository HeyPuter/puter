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
const { AdvancedBase } = require('@heyputer/putility');
const { BaseES } = require('./BaseES');

const APIError = require('../../api/APIError');
const { Entity } = require('./Entity');
const { WeakConstructorFeature } = require('../../traits/WeakConstructorFeature');
const { And, Or, Eq, Like, Null, Predicate, PredicateUtil, IsNotNull, StartsWith } = require('../query/query');
const { DB_WRITE } = require('../../services/database/consts');

class RawCondition extends AdvancedBase {
    // properties: sql:string, values:any[]
    static FEATURES = [
        new WeakConstructorFeature(),
    ];
}

class SQLES extends BaseES {
    async _on_context_provided () {
        const services = this.context.get('services');
        this.db = services.get('database').get(DB_WRITE, 'entity-storage');
    }
    static METHODS = {
        async create_predicate (id, args) {
            if ( id === 'raw-sql-condition' ) {
                return new RawCondition(args);
            }
        },
        async read (uid) {

            const [stmt_where, where_vals] = await (async () => {
                if ( typeof uid !== 'object' ) {
                    const id_prop =
                        this.om.properties[this.om.primary_identifier];
                    let id_col =
                        id_prop.descriptor.sql?.column_name ?? id_prop.name;
                    // Temporary hack until multiple identifiers are supported
                    // (allows us to query using an internal ID; users can't do this)
                    if ( typeof uid === 'number' ) {
                        id_col = 'id';
                    }
                    return [` WHERE ${id_col} = ?`, [uid]];
                }

                if ( ! uid.hasOwnProperty('predicate') ) {
                    throw new Error('SQLES.read does not understand this input: ' +
                        'object with no predicate property');
                }
                let predicate = uid.predicate; // uid is actually a predicate
                if ( predicate instanceof Predicate ) {
                    predicate = await this.om_to_sql_condition_(predicate);
                }
                const stmt_where = ` WHERE ${predicate.sql} LIMIT 1` ;
                const where_vals = predicate.values;
                return [stmt_where, where_vals];
            })();

            const stmt =
                `SELECT * FROM ${this.om.sql.table_name}${stmt_where}`;

            const rows = await this.db.read(stmt, where_vals);

            if ( rows.length === 0 ) {
                return null;
            }

            const data = rows[0];
            const entity = await this.sql_row_to_entity_(data);

            return entity;
        },

        async select ({ predicate, limit, offset }) {
            if ( predicate instanceof Predicate ) {
                predicate = await this.om_to_sql_condition_(predicate);
            }

            const stmt_where = predicate ? ` WHERE ${predicate.sql}` : '';

            let stmt =
                `SELECT * FROM ${this.om.sql.table_name}${stmt_where}`;

            if ( offset !== undefined && limit === undefined ) {
                throw new Error('Cannot use offset without limit');
            }

            if ( limit ) {
                stmt += ` LIMIT ${limit}`;
            }
            if ( offset ) {
                stmt += ` OFFSET ${offset}`;
            }

            const values = [];
            if ( predicate ) values.push(...(predicate.values || []));

            const rows = await this.db.read(stmt, values);

            const entities = [];
            for ( const data of rows ) {
                const entity = await this.sql_row_to_entity_(data);
                entities.push(entity);
            }

            return entities;
        },

        async upsert (entity, extra) {
            const { old_entity } = extra;

            // Check unique constraints
            for ( const prop of Object.values(this.om.properties) ) {
                const options = prop.descriptor.sql ?? {};
                if ( ! prop.descriptor.unique ) continue;

                const col_name = options.column_name ?? prop.name;
                const value = await entity.get(prop.name);

                const values = [];
                let stmt =
                    `SELECT COUNT(*) FROM ${this.om.sql.table_name} WHERE ${col_name} = ?`;
                values.push(value);

                if ( old_entity ) {
                    stmt += ' AND id != ?';
                    values.push(old_entity.private_meta.mysql_id);
                }

                const rows = await this.db.read(stmt, values);
                const count = rows[0]['COUNT(*)'];

                if ( count > 0 ) {
                    throw APIError.create('already_in_use', null, {
                        what: prop.name,
                        value,
                    });
                }
            }

            // Update or create
            if ( old_entity ) {
                const result = await this.update_(entity, old_entity);
                result.insert_id = old_entity.private_meta.mysql_id;
                return result;
            } else {
                return await this.create_(entity);
            }
        },

        async delete (uid, extra) {
            const id_prop = this.om.properties[this.om.primary_identifier];
            let id_col =
                id_prop.descriptor.sql?.column_name ?? id_prop.name;

            const stmt =
                `DELETE FROM ${this.om.sql.table_name} WHERE ${id_col} = ?`;

            const res = await this.db.write(stmt, [uid]);

            if ( ! res.anyRowsAffected ) {
                throw APIError.create('entity_not_found', null, {
                    'identifier': uid,
                });
            }

            return {
                data: {},
            };
        },

        async sql_row_to_entity_ (data) {
            const entity_data = {};
            for ( const prop of Object.values(this.om.properties) ) {
                const options = prop.descriptor.sql ?? {};

                if ( options.ignore ) {
                    continue;
                }

                const col_name = options.column_name ?? prop.name;

                if ( ! data.hasOwnProperty(col_name) ) {
                    continue;
                }

                let value = data[col_name];
                value = await prop.sql_dereference(value);

                // TODO: This is not an ideal implementation,
                // but this is only 6 lines of code so doing this
                // "properly" is not sensible at this time.
                //
                // This is here because:
                // - SQLES has access to the "db" object
                //
                // Writing this in `json`'s `sql_reference` method
                // is also not ideal because that places the concern
                // of supporting different database backends to
                // property types.
                //
                // Best solution: SQLES has a SQLRefinements by
                // composition. This SQLRefinements is applied
                // to property types for the duration of this
                // function.
                if ( prop.typ.name === 'json' ) {
                    value = this.db.case({
                        mysql: () => value,
                        otherwise: () => JSON.parse(value ?? '{}'),
                    })();
                }

                entity_data[prop.name] = value;
            }
            const entity = await Entity.create({ om: this.om }, entity_data);
            entity.private_meta.mysql_id = data.id;
            return entity;
        },

        async create_ (entity) {
            const sql_data = await this.get_sql_data_(entity);

            const sql_cols = Object.keys(sql_data).join(', ');
            const sql_placeholders = Object.keys(sql_data).map(() => '?').join(', ');
            const execute_vals = Object.values(sql_data);

            const stmt =
                `INSERT INTO ${this.om.sql.table_name} (${sql_cols}) VALUES (${sql_placeholders})`;

            // Very useful when debugging! Keep these here but commented out.
            // console.log('SQL STMT', stmt);
            // console.log('SQL VALS', execute_vals);

            const res = await this.db.write(stmt, execute_vals);

            return {
                data: sql_data,
                entity,
                insert_id: res.insertId,
            };
        },
        async update_ (entity, old_entity) {
            const sql_data = await this.get_sql_data_(entity);
            const id_value = await entity.get(this.om.primary_identifier);
            delete sql_data[this.om.primary_identifier];

            const sql_assignments = Object.keys(sql_data).map((col_name) => {
                return `${col_name} = ?`;
            }).join(', ');
            const execute_vals = Object.values(sql_data);

            const id_prop = this.om.properties[this.om.primary_identifier];
            const id_col =
                id_prop.descriptor.sql?.column_name ?? id_prop.name;

            const stmt =
                `UPDATE ${this.om.sql.table_name} SET ${sql_assignments} WHERE ${id_col} = ?`;

            execute_vals.push(id_value);

            // Very useful when debugging! Keep these here but commented out.
            // console.log('SQL STMT', stmt);
            // console.log('SQL VALS', execute_vals);

            await this.db.write(stmt, execute_vals);

            const full_entity = await (await old_entity.clone()).apply(entity);

            return {
                data: sql_data,
                entity: full_entity,
            };
        },

        async get_sql_data_ (entity) {
            const sql_data = {};

            for ( const prop of Object.values(this.om.properties) ) {
                const options = prop.descriptor.sql ?? {};

                if ( ! await entity.has(prop.name) ) {
                    continue;
                }

                if ( options.ignore ) {
                    continue;
                }

                const col_name = options.column_name ?? prop.name;
                let value = await entity.get(prop.name);
                if ( value === undefined ) {
                    continue;
                }

                value = await prop.sql_reference(value);

                // TODO: This is done here for consistency;
                // see the larger comment in sql_row_to_entity_
                // which does the reverse operation.
                if ( prop.typ.name === 'json' ) {
                    value = JSON.stringify(value);
                }

                if ( value && options.use_id ) {
                    if ( value.hasOwnProperty('id') ) {
                        value = value.id;
                    }
                }

                sql_data[col_name] = value;
            }

            return sql_data;
        },

        async om_to_sql_condition_ (om_query) {
            om_query = PredicateUtil.simplify(om_query);

            if ( om_query instanceof Null ) {
                return undefined;
            }

            if ( om_query instanceof And ) {
                const child_raw_conditions = [];
                const values = [];
                for ( const child of om_query.children ) {
                    // if ( child instanceof Null ) continue;
                    const sql_condition = await this.om_to_sql_condition_(child);
                    child_raw_conditions.push(sql_condition.sql);
                    values.push(...(sql_condition.values || []));
                }

                const sql = child_raw_conditions.map((sql) => {
                    return `(${sql})`;
                }).join(' AND ');

                return new RawCondition({ sql, values });
            }

            if ( om_query instanceof Or ) {
                const child_raw_conditions = [];
                const values = [];
                for ( const child of om_query.children ) {
                    // if ( child instanceof Null ) continue;
                    const sql_condition = await this.om_to_sql_condition_(child);
                    child_raw_conditions.push(sql_condition.sql);
                    values.push(...(sql_condition.values || []));
                }

                const sql = child_raw_conditions.map((sql) => {
                    return `(${sql})`;
                }).join(' OR ');

                return new RawCondition({ sql, values });
            }

            if ( om_query instanceof Eq ) {
                const key = om_query.key;
                let value = om_query.value;
                const prop = this.om.properties[key];

                value = await prop.sql_reference(value);

                const options = prop.descriptor.sql ?? {};
                const col_name = options.column_name ?? prop.name;

                const sql = value === null ? `${col_name} IS NULL` : `${col_name} = ?`;
                const values = value === null ? [] : [value];

                return new RawCondition({ sql, values });
            }

            if ( om_query instanceof StartsWith ) {
                const key = om_query.key;
                let value = om_query.value;
                const prop = this.om.properties[key];

                value = await prop.sql_reference(value);

                const options = prop.descriptor.sql ?? {};
                const col_name = options.column_name ?? prop.name;

                const sql = `${col_name} LIKE ${this.db.case({
                    sqlite: '? || \'%\'',
                    otherwise: 'CONCAT(?, \'%\')',
                })}`;
                const values = value === null ? [] : [value];

                return new RawCondition({ sql, values });
            }

            if ( om_query instanceof IsNotNull ) {
                const key = om_query.key;
                let value = om_query.value;
                const prop = this.om.properties[key];

                value = await prop.sql_reference(value);

                const options = prop.descriptor.sql ?? {};
                const col_name = options.column_name ?? prop.name;

                const sql = `${col_name} IS NOT NULL`;
                const values = [value];

                return new RawCondition({ sql, values });
            }

            if ( om_query instanceof Like ) {
                const key = om_query.key;
                let value = om_query.value;
                const prop = this.om.properties[key];

                value = await prop.sql_reference(value);

                const options = prop.descriptor.sql ?? {};
                const col_name = options.column_name ?? prop.name;

                const sql = `${col_name} LIKE ?`;
                const values = [value];

                return new RawCondition({ sql, values });
            }
        },
    };
}

module.exports = SQLES;
