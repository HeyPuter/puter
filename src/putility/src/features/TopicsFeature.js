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

const { RemoveFromArrayDetachable } = require("../libs/listener");
const { TTopics } = require("../traits/traits");
const { install_in_instance } = require("./NodeModuleDIFeature");

module.exports = {
    install_in_instance: (instance, { parameters }) => {
        const topics = instance._get_merged_static_array('TOPICS');

        instance._.topics = {};

        for ( const name of topics ) {
            instance._.topics[name] = {
                listeners_: [],
            };
        }

        instance.mixin(TTopics, {
            pub: (k, v) => {
                if ( k.includes('!') ) {
                    throw new Error(
                        '"!" in event name reserved for future use');
                }
                const topic = instance._.topics[k];
                if ( ! topic ) {
                    console.warn('missing topic: ' + topic);
                    return;
                }
                for ( const lis of topic.listeners_ ) {
                    lis();
                }
            },
            sub: (k, fn) => {
                const topic = instance._.topics[k];
                if ( ! topic ) {
                    console.warn('missing topic: ' + topic);
                    return;
                }
                topic.listeners_.push(fn);
                return new RemoveFromArrayDetachable(topic.listeners_, fn);
            }
        })

    }
};
