// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o-mini"}}
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
const { BasicBase } = require("../../../../../putility/src/bases/BasicBase");
const { TypeSpec } = require("./Construct");


/**
* Represents an entity in the runtime environment that extends the BasicBase class.
* This class serves as a foundational type for creating various runtime constructs 
* within the drivers subsystem, enabling the implementation of specialized behaviors 
* and properties.
*/
class RuntimeEntity extends BasicBase {
}


/**
* Represents a base runtime entity that extends functionality 
* from the BasicBase class. This entity can be used as a 
* foundation for creating more specific runtime objects 
* within the application, enabling consistent behavior across 
* derived entities.
*/
class TypedValue extends RuntimeEntity {
    constructor (type, value) {
        super();
        this.type = TypeSpec.adapt(type);
        this.value = value;
        this.calculated_coercions_ = {};
    }
}

module.exports = {
    TypedValue
};
