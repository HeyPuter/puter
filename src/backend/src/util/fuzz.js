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

/**
* Rounds numbers to human-friendly thresholds commonly used for displaying metrics.
* 
* This function implements a stepwise rounding system:
* - For small numbers (1-99): Uses specific thresholds (1+, 10+, 50+) to avoid showing exact small counts
* - For hundreds (100-999): Rounds to 100+ or 500+
* - For thousands (1K-999K): Uses K+ notation with 1K, 5K, 10K, 50K, 100K, 500K thresholds
* - For millions (1M-999M): Uses M+ notation with 1M, 5M, 10M, 50M, 100M, 500M thresholds
* - For billions: Shows as 1B+
* 
* The rounding is always down to the nearest threshold to ensure the "+" symbol
* accurately indicates there are at least that many items.
* 
* @param {number} num - The number to be rounded
* @returns {number} The rounded number according to the threshold rules
*                  (without the "+" symbol, which should be added by display logic)
* 
* @example
* fuzz_number(7)         // returns 1      (displays as "1+")
* fuzz_number(45)        // returns 10     (displays as "10+")
* fuzz_number(2500)      // returns 1000   (displays as "1K+")
* fuzz_number(7500000)   // returns 5000000 (displays as "5M+")
*/

function fuzz_number(num) {
    // If the number is 0, return 0
    if (num === 0) return 0;

    // For 1-9
    if (num < 10) return 1;
    
    // For 10-49
    if (num < 50) return 10;
    
    // For 50-99
    if (num < 100) return 50;
    
    // For 100-499
    if (num < 500) return 100;
    
    // For 500-999
    if (num < 1000) return 500;
    
    // For 1K-4.99K
    if (num < 5000) return 1000;
    
    // For 5K-9.99K
    if (num < 10000) return 5000;
    
    // For 10K-49.99K
    if (num < 50000) return 10000;
    
    // For 50K-99.99K
    if (num < 100000) return 50000;
    
    // For 100K-499.99K
    if (num < 500000) return 100000;
    
    // For 500K-999.99K
    if (num < 1000000) return 500000;
    
    // For 1M-4.99M
    if (num < 5000000) return 1000000;
    
    // For 5M-9.99M
    if (num < 10000000) return 5000000;
    
    // For 10M-49.99M
    if (num < 50000000) return 10000000;
    
    // For 50M-99.99M
    if (num < 100000000) return 50000000;
    
    // For 100M-499.99M
    if (num < 500000000) return 100000000;
    
    // For 500M-999.99M
    if (num < 1000000000) return 500000000;
    
    // For 1B+
    return 1000000000;
}

module.exports = {
    fuzz_number
};