import { describe, expect, it } from 'vitest';
import { resolveSubject } from './resolveSubject.js';

const app = { appID: 'app-123' };
const uid = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('resolveSubject', () => {
    it('resolves bare and ./ relative paths alike under the app folder', () => {
        for ( const ref of ['inbox', './inbox'] ) {
            expect(resolveSubject(`fs:${ref}`, app)).toBe('fs:~/AppData/app-123/inbox');
            expect(resolveSubject(`fs:${ref}/a.txt:write`, app))
                .toBe('fs:~/AppData/app-123/inbox/a.txt:write');
            expect(resolveSubject(`fs:${ref}/**/*.json:add`, app))
                .toBe('fs:~/AppData/app-123/inbox/**/*.json:add');
        }
    });

    it('resolves relative paths under home without an app', () => {
        expect(resolveSubject('fs:inbox', {})).toBe('fs:~/inbox');
        expect(resolveSubject('fs:./inbox:add', {})).toBe('fs:~/inbox:add');
    });

    it('leaves absolute, home, and uid subjects alone', () => {
        for ( const subject of [
            'fs:~/Documents',
            'fs:/alice/Documents:write',
            `fs:${uid}`,
            `fs:${uid}:remove`,
        ] ) {
            expect(resolveSubject(subject, app)).toBe(subject);
        }
    });

    it('reads ./<uid-shaped name> as a path', () => {
        expect(resolveSubject(`fs:./${uid}`, app)).toBe(`fs:~/AppData/app-123/${uid}`);
    });

    it('leaves other families alone', () => {
        expect(resolveSubject('kv:cart', app)).toBe('kv:cart');
        expect(resolveSubject('notif:account', app)).toBe('notif:account');
    });
});
