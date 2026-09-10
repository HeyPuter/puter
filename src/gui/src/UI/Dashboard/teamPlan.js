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
 * The team's plan card, drawn from whatever catalogue the server returned. No
 * tier, price or payment provider is known here.
 *
 * @param {object} args `{ plan, seats, canBuy }`
 * @returns {string} markup, or '' when there is no catalogue
 */
export const teamPlanHtml = ({ plan, seats = 0, canBuy = false } = {}) => {
    if ( plan?.status !== 'ready' ) return '';
    const current = plan.current ?? null;
    const offerings = Array.isArray(plan.offerings) ? plan.offerings : [];

    let h = '<div class="dashboard-card teams-panel teams-plan">';
    h += `<h3>${i18n('teams_plan')}</h3>`;

    if ( current ) {
        const key = seats === 1 ? 'teams_plan_current_one' : 'teams_plan_current';
        h += `<p class="teams-panel-hint">${i18n(key, {
            plan: current.name_en || current.tier,
            seats,
        })}</p>`;
        if ( current.status && current.status !== 'active' ) {
            h += `<p class="teams-plan-status">${window.html_encode(current.status)}</p>`;
        }
    } else {
        h += `<p class="teams-panel-hint">${i18n('teams_plan_none')}</p>`;
    }

    if ( offerings.length ) {
        h += '<ul class="teams-plan-list">';
        for ( const o of offerings ) {
            h += '<li class="teams-plan-option">';
            h += `<span class="teams-plan-name">${window.html_encode(o.name_en || o.tier)}</span>`;
            h += `<span class="teams-plan-price">${i18n('teams_plan_per_seat', {
                amount: o.amountPerSeat,
                currency: o.currency,
            })}</span>`;
            if ( current?.tier === o.tier ) {
                h += `<span class="teams-plan-badge">${i18n('teams_plan_current_badge')}</span>`;
            } else if ( ! o.available ) {
                // The server says no price is configured; buying would 422.
                h += `<span class="teams-plan-badge">${i18n('teams_plan_unavailable')}</span>`;
            } else if ( canBuy ) {
                const label = current ? i18n('teams_plan_switch') : i18n('teams_plan_buy');
                h += `<button class="button teams-plan-buy" data-item-id="${window.html_encode(o.itemId)}">${label}</button>`;
            }
            h += '</li>';
        }
        h += '</ul>';
    }
    h += '</div>';
    return h;
};

export default teamPlanHtml;
