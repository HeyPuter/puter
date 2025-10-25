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
 * Builds a consistent settings card HTML structure
 * @param {Object} config - Card configuration
 * @param {string} config.label - Main label text for the card
 * @param {string} [config.description] - Optional description text shown below label
 * @param {string} [config.control] - HTML for the control element (button, select, etc.)
 * @param {string} [config.variant] - Card variant: 'danger', 'success', 'warning', or undefined for default
 * @param {string} [config.className] - Additional CSS classes to add
 * @returns {string} HTML string for the settings card
 */
export default function build_settings_card(config) {
    const {
        label,
        description,
        control = '',
        variant,
        className = '',
    } = config;

    const variantClass = variant ? `settings-card-${variant}` : '';
    const classes = `settings-card ${variantClass} ${className}`.trim();

    let labelContent = `<strong class="settings-card-label">${label}</strong>`;
    if ( description ) {
        labelContent = `<div class="settings-card-label">
            <strong>${label}</strong>
            <span class="settings-card-description">${description}</span>
        </div>`;
    }

    return `<div class="${classes}">
        <div class="settings-card-row">
            ${labelContent}
            ${control ? `<div class="settings-card-control">${control}</div>` : ''}
        </div>
    </div>`;
}
