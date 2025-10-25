/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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
