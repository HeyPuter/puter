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
const { AdvancedBase } = require('./src/AdvancedBase');
const { Service } = require('./src/concepts/Service');
const { ServiceManager } = require('./src/system/ServiceManager');
const { TTopics } = require('./src/traits/traits');

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
    },
    concepts: {
        Service,
    },
    traits: {
        TTopics,
    },
};
