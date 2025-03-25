/**
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
 * Plays the Puter startup chime sound if enabled in settings
 * @returns {Promise<void>} A promise that resolves when the sound has played or if playing is skipped
 */
export default async function play_startup_chime() {
    try {
        // Check if startup chime is enabled in settings
        const startupChimeEnabled = await puter.kv.get('startup_chime_enabled');
        
        // If explicitly disabled, don't play
        if (startupChimeEnabled === 'false') {
            return;
        }
        
        // Create audio element and play the chime
        const audio = new Audio('/audio/puter_chime.mp3');
        await audio.play();
    } catch (error) {
        // Silently fail if audio can't be played (common in browsers without user interaction)
        console.log('Could not play startup chime:', error);
    }
}