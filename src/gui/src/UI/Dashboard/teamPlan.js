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
export const teamPlanHtml = ({ plan, canBuy = false } = {}) => {
    if ( plan?.status !== 'ready' ) return '';
    const offerings = Array.isArray(plan.offerings) ? plan.offerings : [];
    const quantities = plan.tierQuantities ?? {};
    const onSomething = Object.values(quantities).some(n => n > 0);

    let h = '<div class="dashboard-card teams-panel teams-plan">';
    h += `<h3>${i18n('teams_plan')}</h3>`;
    h += `<p class="teams-panel-hint">${i18n(
        onSomething ? 'teams_plan_per_account_hint' : 'teams_plan_none',
    )}</p>`;
    if ( plan.subStatus && plan.subStatus !== 'active' ) {
        h += `<p class="teams-plan-status">${window.html_encode(plan.subStatus)}</p>`;
    }

    h += '<ul class="teams-plan-list">';
    for ( const o of offerings ) {
        const count = quantities[o.tier] ?? 0;
        h += '<li class="teams-plan-option">';
        h += `<span class="teams-plan-name">${window.html_encode(o.name_en || o.tier)}</span>`;
        h += `<span class="teams-plan-price">${i18n('teams_plan_per_seat', {
            amount: o.amountPerSeat,
            currency: o.currency,
        })}</span>`;
        if ( count > 0 ) {
            h += `<span class="teams-plan-badge">${i18n('teams_plan_on_count', { count })}</span>`;
        } else if ( ! o.available ) {
            // The server says no price is configured; buying would 422.
            h += `<span class="teams-plan-badge">${i18n('teams_plan_unavailable')}</span>`;
        }
        h += '</li>';
    }
    h += '</ul>';
    if ( canBuy ) {
        h += `<p class="teams-panel-hint">${i18n('teams_plan_assign_hint')}</p>`;
    }
    h += '</div>';
    return h;
};

export default teamPlanHtml;
