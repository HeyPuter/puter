// @vitest-environment jsdom
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { offerAppTabLaunch } from './appTabLaunch.js';

const ORIGIN = 'https://notes.example.com';
const ITEM = { 'puter.item.uid': 'file-1', 'puter.item.read_url': 'https://api.puter.test/file?signature=r' };
let nextId = 0;

const offer = () => {
    const appInstanceID = `instance-${++nextId}`;
    const tab = { postMessage: vi.fn() };
    offerAppTabLaunch({ appInstanceID, tab, origin: ORIGIN, token: 'app-token', item: ITEM });
    return { appInstanceID, tab };
};

const request = ({ appInstanceID, source, origin = ORIGIN }) => {
    window.dispatchEvent(new MessageEvent('message', {
        data: { msg: 'puter.requestLaunch', env: 'app-tab', appInstanceID },
        origin,
        source,
    }));
};

afterEach(() => {
    vi.useRealTimers();
});

describe('offerAppTabLaunch', () => {
    it('answers the tab it was offered to, at its origin, once', () => {
        const { appInstanceID, tab } = offer();
        request({ appInstanceID, source: tab });
        request({ appInstanceID, source: tab });
        expect(tab.postMessage).toHaveBeenCalledOnce();
        expect(tab.postMessage).toHaveBeenCalledWith({
            msg: 'puter.launch',
            appInstanceID,
            token: 'app-token',
            item: ITEM,
        }, ORIGIN);
    });

    it('ignores another window that knows the instance id', () => {
        const { appInstanceID, tab } = offer();
        const other = { postMessage: vi.fn() };
        request({ appInstanceID, source: other });
        expect(other.postMessage).not.toHaveBeenCalled();
        expect(tab.postMessage).not.toHaveBeenCalled();
    });

    it('ignores the tab once it has navigated to another origin', () => {
        const { appInstanceID, tab } = offer();
        request({ appInstanceID, source: tab, origin: 'https://elsewhere.example' });
        expect(tab.postMessage).not.toHaveBeenCalled();
    });

    it('withdraws an offer nobody asked for in time', () => {
        vi.useFakeTimers();
        const { appInstanceID, tab } = offer();
        vi.advanceTimersByTime(2 * 60 * 1000);
        request({ appInstanceID, source: tab });
        expect(tab.postMessage).not.toHaveBeenCalled();
    });
});
