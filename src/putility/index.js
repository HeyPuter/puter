/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 */

const { AdvancedBase } = require('./src/AdvancedBase');
const { Service } = require('./src/concepts/Service');
const { ServiceManager } = require('./src/system/ServiceManager');
const traits = require('./src/traits/traits');

module.exports = {
    AdvancedBase,
    system: {
        ServiceManager,
    },
    libs: {
        promise: require('./src/libs/promise'),
        context: require('./src/libs/context'),
        listener: require('./src/libs/listener'),
        log: require('./src/libs/log'),
        string: require('./src/libs/string'),
        time: require('./src/libs/time'),
        smol: require('./src/libs/smol'),
        event: require('./src/libs/event'),
    },
    features: {
        EmitterFeature: require('./src/features/EmitterFeature'),
    },
    concepts: {
        Service,
    },
    traits,
};
