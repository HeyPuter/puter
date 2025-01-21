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
let memoized_common_template_vars_ = null;
const get_common_template_vars = () => {
    const path_ = require('path');
    if ( memoized_common_template_vars_ !== null ) {
        return memoized_common_template_vars_;
    }

    const code_root = path_.resolve(__dirname, '../../');

    memoized_common_template_vars_ = {
        code_root,
    };

    return memoized_common_template_vars_;
}

module.exports = {
    get_common_template_vars,
};
