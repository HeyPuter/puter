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
// This doesn't go in ./bases because it logically depends on
// both ./bases and ./traits, and ./traits depends on ./bases.

const { FeatureBase } = require("./bases/FeatureBase");

class AdvancedBase extends FeatureBase {
    static FEATURES = [
        require('./features/NodeModuleDIFeature'),
        require('./features/PropertiesFeature'),
        require('./features/TraitsFeature'),
        require('./features/NariMethodsFeature'),
        require('./features/TopicsFeature'),
    ]
}

module.exports = {
    AdvancedBase,
};
