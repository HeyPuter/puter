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

const UIElement = use('ui.UIElement');
const Collector = use('util.Collector');

const el = UIElement.el;

class UIGroupsManager extends UIElement {
    static CSS = `
        .alpha-warning {
            background-color: #f8d7da;
            color: #721c24;
            padding: 10px;
            margin-bottom: 20px;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
        }

        .group {
            display: flex;
            align-items: center;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 4px;
            margin-bottom: 10px;
        }

        .group-name {
            font-size: 18px;
            font-weight: bold;
        }
        
        .group-name::before {
            content: '👥';
            margin-right: 10px;
        }
    `;
    async make ({ root }) {
        const experimental_ui_notice = el('div.alpha-warning', {
            text: `This feature is under development.`
        });
        root.appendChild(experimental_ui_notice);

        // TODO: we shouldn't have to construct this every time;
        // maybe GUI itself can provide an instance of Collector
        this.collector = new Collector({
            antiCSRF: window.services?.get?.('anti-csrf'),
            origin: window.api_origin,
            authToken: puter.authToken,
        });

        const groups = await this.collector.get('/group/list');
        const groups_el = el('div', groups.in_groups.map(group => {
            let title, color = '#FFF';
            if ( group.metadata ) {
                title = group.metadata.title;
                color = group.metadata.color;
            }

            if ( ! title ) {
                title = group.uid;
            }

            const group_el = el('div.group', [
                el('div.group-name', {
                    text: title,
                }),
            ]);

            if ( color ) {
                group_el.style.backgroundColor = color;
            }

            return group_el;
        }));
        root.appendChild(groups_el);
    }
}

$(window).on('ctxmenu-will-open', event => {
    if ( event.detail.options?.id !== 'user-options-menu' ) return;
    if ( ! window.experimental_features ) return;

    const newMenuItems = [
        {
            id: 'groups-manager',
            html: 'Groups Manager',
            action: () => {
                const groupsManager = new UIGroupsManager();
                groupsManager.open_as_window();
            }
        }
    ];

    const items = event.detail.options.items;

    const insertBeforeIndex = 1 +
        items.findIndex(item => item.id === 'task_manager');

    if ( insertBeforeIndex === -1 ) {
        event.detail.options.items = [...items, ...newMenuItems];
        return;
    }

    const firstHalf = items.slice(0, insertBeforeIndex);
    const secondHalf = items.slice(insertBeforeIndex);
    event.detail.options.items = [...firstHalf, ...newMenuItems, ...secondHalf];
});
