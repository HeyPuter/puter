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
/**
 * An error for which the location it occurred within the input is known.
 */
export class ConcreteSyntaxError extends Error {
    constructor (message, cst_location) {
        super(message);
        this.cst_location = cst_location;
    }

    /**
     * Prints the location of the error in the input.
     *
     * Example output:
     *
     * ```
     * 1: echo $($(echo zxcv))
     *           ^^^^^^^^^^^
     * ```
     *
     * @param {*} input
     */
    print_here (input) {
        const lines = input.split('\n');
        const line = lines[this.cst_location.line];
        const str_line_number = `${String(this.cst_location.line + 1) }: `;
        const n_spaces =
            str_line_number.length +
            this.cst_location.start;
        const n_arrows = Math.max(this.cst_location.end - this.cst_location.start,
                        1);

        return (
            `${str_line_number + line }\n${
                ' '.repeat(n_spaces) }${'^'.repeat(n_arrows)}`
        );
    }
}
