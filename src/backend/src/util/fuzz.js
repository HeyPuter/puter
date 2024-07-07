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
// function fuzz_number(n) {
//     if (n === 0) return 0;
    
//     // let randomized = n + (Math.random() - 0.5) * n * 0.2;
//     let randomized = n;
//     let magnitude = Math.floor(Math.log10(randomized));
//     let factor = Math.pow(10, magnitude);
//     return Math.round(randomized / factor) * factor;
// }

function fuzz_number(num) {
    // If the number is 0, then return 0
    if (num === 0) return 0;

    const magnitude = Math.floor(Math.log10(Math.abs(num)));

    let significantFigures;

    if (magnitude < 2) {             // Numbers < 100
        significantFigures = magnitude + 1;
    } else if (magnitude < 5) {      // Numbers < 100,000
        significantFigures = 2;
    } else {                        // Numbers >= 100,000
        significantFigures = 3;
    }

    const factor = Math.pow(10, magnitude - significantFigures + 1);
    return Math.round(num / factor) * factor;
}

// function fuzz_number(number) {
//     if (isNaN(number)) {
//         return 'Invalid number';
//     }

//     let formattedNumber;
//     if (number >= 1000000) {
//         // For millions, we want to show one decimal place
//         formattedNumber = (number / 1000000).toFixed(0) + 'm';
//     } else if (number >= 1000) {
//         // For thousands, we want to show one decimal place
//         formattedNumber = (number / 1000).toFixed(0) + 'k';
//     } else if (number >= 500) {
//         // For hundreds, we want to show no decimal places
//         formattedNumber = '500+';
//     } else if (number >= 100) {
//         // For hundreds, we want to show no decimal places
//         formattedNumber = '100+';
//     } else if (number >= 50) {
//         // For hundreds, we want to show no decimal places
//         formattedNumber = '50+';
//     } else if (number >= 10) {
//         // For hundreds, we want to show no decimal places
//         formattedNumber = '10+';
//     }
//     else {
//         // For numbers less than 10, we show the number as is.
//         formattedNumber = '1+';
//     }

//     // If the decimal place is 0 (e.g., 5.0k), we remove the decimal part (to have 5k instead)
//     formattedNumber = formattedNumber.replace(/\.0(?=[k|m])/, '');

//     // Append the plus sign for numbers 1000 and greater, denoting the number is 'this value or more'.
//     if (number >= 1000) {
//         formattedNumber += '+';
//     }

//     return formattedNumber;
// }

module.exports = {
    fuzz_number
};
