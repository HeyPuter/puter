// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const BaseService = require("../BaseService");
const { TypeSpec } = require("./meta/Construct");
const { TypedValue } = require("./meta/Runtime");


/**
* CoercionService class is responsible for handling coercion operations
* between TypedValue instances and their target TypeSpec representations.
* It provides functionality to construct and initialize coercions that 
* can convert one type into another, based on specified produces and 
* consumes specifications.
*/
class CoercionService extends BaseService {
    static MODULES = {
        axios: require('axios'),
    }


    /**
     * Attempt to coerce a TypedValue to a target TypeSpec.
     * This method checks if the current TypedValue can be adapted to the specified target TypeSpec,
     * using the available coercions defined in the service. It implements caching for previously calculated coercions.
     * 
     * @param {*} target - the target TypeSpec
     * @param {*} typed_value - the TypedValue to coerce
     * @returns {TypedValue|undefined} - the coerced TypedValue, or undefined if coercion cannot be performed
     */
    async _construct () {
        this.coercions_ = [];
    }


    /**
     * Initializes the coercion service by populating the coercions_ array
     * with predefined coercion rules that specify how TypedValues should 
     * be processed. This method should be called before any coercion 
     * operations are performed.
     */
    async _init () {
        this.coercions_.push({
            produces: {
                $: 'stream',
                content_type: 'image'
            },
            consumes: {
                $: 'string:url:web',
                content_type: 'image'
            },
            coerce: async typed_value => {
                this.log.noticeme('coercion is running!');
                const response = await CoercionService.MODULES.axios.get(typed_value.value, {
                    responseType: 'stream',
                });


                return new TypedValue({
                    $: 'stream',
                    content_type: response.headers['content-type'],
                }, response.data);
            }
        });
    }

    /**
     * Attempt to coerce a TypedValue to a target TypeSpec.
     * Note: this is implemented similarly to MultiValue.get.
     * @param {*} target - the target TypeSpec
     * @param {*} typed_value - the TypedValue to coerce
     * @returns {TypedValue|undefined} - the coerced TypedValue, or undefined
     */
    /**
     * Attempt to coerce a TypedValue to a target TypeSpec.
     * This method first adapts the target and the current type of the 
     * TypedValue. If they are equal, it returns the original TypedValue. 
     * Otherwise, it checks if the coercion has been calculated before, 
     * retrieves applicable coercions, and applies them to the TypedValue.
     * 
     * @param {*} target - the target TypeSpec to which the TypedValue should be coerced
     * @param {*} typed_value - the TypedValue to coerce
     * @returns {TypedValue|undefined} - the coerced TypedValue if successful, or undefined
     */
    async coerce (target, typed_value) {
        target = TypeSpec.adapt(target);
        const target_hash = target.hash();

        const current_type = TypeSpec.adapt(typed_value.type);

        if ( target.equals(current_type) ) {
            return typed_value;
        }

        if ( typed_value.calculated_coercions_[target_hash] ) {
            return typed_value.calculated_coercions_[target_hash];
        }

        const coercions = this.coercions_.filter(coercion => {
            const produces = TypeSpec.adapt(coercion.produces);
            return target.equals(produces);
        });

        for ( const coercion of coercions ) {
            const available = await this.coerce(coercion.consumes, typed_value);
            if ( ! available ) continue;
            const coerced = await coercion.coerce(available);
            typed_value.calculated_coercions_[target_hash] = coerced;
            return coerced;
        }

        return typed_value;
    }
}

module.exports = { CoercionService };
