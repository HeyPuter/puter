// METADATA // {"def":"core.util.identutil"}
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
const adjectives = [
    'amazing', 'ambitious', 'articulate', 'cool', 'bubbly', 'mindful', 'noble', 'savvy', 'serene', 
    'sincere', 'sleek', 'sparkling', 'spectacular', 'splendid', 'spotless', 'stunning',
    'awesome', 'beaming', 'bold', 'brilliant', 'cheerful', 'modest', 'motivated',
    'friendly', 'fun', 'funny', 'generous', 'gifted', 'graceful', 'grateful',
    'passionate', 'patient', 'peaceful', 'perceptive', 'persistent',
    'helpful', 'sensible', 'loyal', 'honest', 'clever', 'capable', 
    'calm', 'smart', 'genius', 'bright', 'charming', 'creative', 'diligent', 'elegant', 'fancy',
    'colorful', 'avid', 'active', 'gentle', 'happy', 'intelligent', 
    'jolly', 'kind', 'lively', 'merry', 'nice', 'optimistic', 'polite',
    'quiet', 'relaxed', 'silly', 'witty', 'young', 
    'strong', 'brave', 'agile', 'bold', 'confident', 'daring', 
    'fearless', 'heroic', 'mighty', 'powerful', 'valiant', 'wise', 'wonderful', 'zealous',    
    'warm', 'swift', 'neat', 'tidy', 'nifty', 'lucky', 'keen',
    'blue', 'red', 'aqua', 'green', 'orange', 'pink', 'purple', 'cyan', 'magenta', 'lime',
    'teal', 'lavender', 'beige', 'maroon', 'navy', 'olive', 'silver', 'gold', 'ivory',
];

const nouns = [
    'street', 'roof', 'floor', 'tv', 'idea', 'morning', 'game', 'wheel', 'bag', 'clock', 'pencil', 'pen',
    'magnet', 'chair', 'table', 'house', 'room', 'book', 'car', 'tree', 'candle', 'light', 'planet',
    'flower', 'bird', 'fish', 'sun', 'moon', 'star', 'cloud', 'rain', 'snow', 'wind', 'mountain',
    'river', 'lake', 'sea', 'ocean', 'island', 'bridge', 'road', 'train', 'plane', 'ship', 'bicycle',
    'circle', 'square', 'garden', 'harp', 'grass', 'forest', 'rock', 'cake', 'pie', 'cookie', 'candy', 
    'butterfly', 'computer', 'phone', 'keyboard', 'mouse', 'cup', 'plate', 'glass', 'door', 
    'window', 'key', 'wallet', 'pillow', 'bed', 'blanket', 'soap', 'towel', 'lamp', 'mirror', 
    'camera', 'hat', 'shirt', 'pants', 'shoes', 'watch', 'ring', 
    'necklace', 'ball', 'toy', 'doll', 'kite', 'balloon', 'guitar', 'violin', 'piano', 'drum',
    'trumpet', 'flute', 'viola', 'cello', 'harp', 'banjo', 'tuba',
]

const words = {
    adjectives,
    nouns,
};

const randomItem = (arr, random) => arr[Math.floor((random ?? Math.random)() * arr.length)];

/**
 * A function that generates a unique identifier by combining a random adjective, a random noun, and a random number (between 0 and 9999).
 * The result is returned as a string with components separated by the specified separator.
 * It is useful when you need to create unique identifiers that are also human-friendly.
 *
 * @param {string} [separator='_'] - The character used to separate the adjective, noun, and number. Defaults to '_' if not provided.
 * @returns {string} A unique, human-friendly identifier.
 *
 * @example
 *
 * let identifier = window.generate_identifier(); 
 * // identifier would be something like 'clever-idea-123'
 *
 */
function generate_identifier(separator = '_', rng = Math.random){
    // return a random combination of first_adj + noun + number (between 0 and 9999)
    // e.g. clever-idea-123
    return [
        randomItem(adjectives, rng),
        randomItem(nouns, rng),
        Math.floor(rng() * 10000),
    ].join(separator);
}

const HUMAN_READABLE_CASE_INSENSITIVE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generate_random_code(n, {
    rng = Math.random,
    chars = HUMAN_READABLE_CASE_INSENSITIVE
} = {}) {
    let code = '';
    for ( let i = 0 ; i < n ; i++ ) {
        code += randomItem(chars, rng);
    }
    return code;
}

/**
 * 
 * @param {*} n length of output code
 * @param {*} mask - a string of characters to start with
 * @param {*} value - a number to be converted to base-36 and put on the right
 */
function compose_code(mask, value) {
    const right_str = value.toString(36);
    let out_str = mask;
    console.log('right_str', right_str);
    console.log('out_str', out_str);
    for ( let i = 0 ; i < right_str.length ; i++ ) {
        out_str[out_str.length - 1 - i] = right_str[right_str.length - 1 - i];
    }

    out_str = out_str.toUpperCase();
    return out_str;
}

module.exports = {
    generate_identifier,
    generate_random_code,
};

