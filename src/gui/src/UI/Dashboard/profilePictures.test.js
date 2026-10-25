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
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PIC = 'data:image/png;base64,AAAA';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Pending lookups by username, settled by the test. */
let lookups;
let mod;

beforeEach(async () => {
    lookups = new Map();
    window.html_encode = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    window.user = { username: 'me', profile: {} };
    window.get_profile_picture = vi.fn((username) => new Promise((resolve, reject) => {
        lookups.set(username, { resolve, reject });
    }));
    window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    vi.resetModules();
    mod = await import('./profilePictures.js');
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('profilePicture', () => {
    it('looks each person up once, however many ask', async () => {
        const a = mod.profilePicture('ann');
        const b = mod.profilePicture('ann');
        lookups.get('ann').resolve(PIC);
        expect(await a).toBe(PIC);
        expect(await b).toBe(PIC);
        expect(await mod.profilePicture('ann')).toBe(PIC);
        expect(window.get_profile_picture).toHaveBeenCalledTimes(1);
    });

    it('remembers that someone has no picture', async () => {
        const first = mod.profilePicture('bob');
        lookups.get('bob').resolve(undefined);
        expect(await first).toBeNull();
        expect(await mod.profilePicture('bob')).toBeNull();
        expect(window.get_profile_picture).toHaveBeenCalledTimes(1);
    });

    it('looks again once the cached answer is stale', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const first = mod.profilePicture('ann');
        lookups.get('ann').resolve(PIC);
        await first;
        vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
        mod.profilePicture('ann');
        expect(window.get_profile_picture).toHaveBeenCalledTimes(2);
    });

    it('resolves null when the lookup fails or returns something other than an image', async () => {
        const failed = mod.profilePicture('ann');
        lookups.get('ann').reject(new Error('offline'));
        expect(await failed).toBeNull();

        const odd = mod.profilePicture('bob');
        lookups.get('bob').resolve('javascript:alert(1)');
        expect(await odd).toBeNull();
    });

    it('reads the signed-in user\'s own picture without a request', async () => {
        window.user.profile.picture = PIC;
        expect(await mod.profilePicture('me')).toBe(PIC);
        window.user.profile.picture = null;
        expect(await mod.profilePicture('me')).toBeNull();
        expect(window.get_profile_picture).not.toHaveBeenCalled();
    });

    it('runs at most four lookups at a time', async () => {
        const names = ['a', 'b', 'c', 'd', 'e', 'f'];
        const all = names.map((name) => mod.profilePicture(name));
        await tick();
        expect([...lookups.keys()]).toEqual(['a', 'b', 'c', 'd']);

        lookups.get('a').resolve(PIC);
        await tick();
        expect([...lookups.keys()]).toEqual(['a', 'b', 'c', 'd', 'e']);

        for ( const name of ['b', 'c', 'd', 'e'] ) lookups.get(name).resolve(null);
        await tick();
        lookups.get('f').resolve(PIC);
        expect(await Promise.all(all)).toEqual([PIC, null, null, null, null, PIC]);
    });
});

describe('avatarUserAttr', () => {
    it('marks an avatar with its encoded username', () => {
        expect(mod.avatarUserAttr('a"b')).toBe(' data-avatar-user="a&quot;b"');
    });

    it('marks nothing without a username', () => {
        expect(mod.avatarUserAttr(undefined)).toBe('');
        expect(mod.avatarUserAttr('')).toBe('');
    });
});

describe('paintAvatars', () => {
    const avatars = () => [...document.querySelectorAll('span')];

    it('lays each person\'s picture over every avatar of theirs, in one lookup', async () => {
        document.body.innerHTML = `<span${mod.avatarUserAttr('ann')}>A</span><span${mod.avatarUserAttr('ann')}>A</span><span>T</span>`;
        mod.paintAvatars(document.body);
        mod.paintAvatars(document.body);
        await tick();
        expect(window.get_profile_picture).toHaveBeenCalledTimes(1);

        lookups.get('ann').resolve(PIC);
        await tick();
        const [first, second, team] = avatars();
        expect(first.classList.contains('has-picture')).toBe(true);
        expect(first.querySelector('img').getAttribute('src')).toBe(PIC);
        expect(second.querySelector('img')).not.toBeNull();
        expect(team.querySelector('img')).toBeNull();
    });

    it('leaves the initial when the person has no picture', async () => {
        document.body.innerHTML = `<span${mod.avatarUserAttr('bob')}>B</span>`;
        mod.paintAvatars(document.body);
        await tick();
        lookups.get('bob').resolve(null);
        await tick();
        expect(avatars()[0].classList.contains('has-picture')).toBe(false);
        expect(avatars()[0].textContent).toBe('B');
    });

    it('paints an avatar only once', async () => {
        window.user.profile.picture = PIC;
        document.body.innerHTML = `<span${mod.avatarUserAttr('me')}>M</span>`;
        mod.paintAvatars(document.body);
        await tick();
        await tick();
        mod.paintAvatars(document.body);
        await tick();
        await tick();
        expect(avatars()[0].querySelectorAll('img')).toHaveLength(1);
    });

    it('drops a picture that fails to load, and doesn\'t try it again', async () => {
        document.body.innerHTML = `<span${mod.avatarUserAttr('ann')}>A</span>`;
        mod.paintAvatars(document.body);
        await tick();
        lookups.get('ann').resolve(PIC);
        await tick();
        avatars()[0].querySelector('img').dispatchEvent(new Event('error'));
        expect(avatars()[0].classList.contains('has-picture')).toBe(false);
        expect(avatars()[0].querySelector('img')).toBeNull();
        expect(await mod.profilePicture('ann')).toBeNull();
    });
});
