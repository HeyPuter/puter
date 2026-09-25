import { afterEach, describe, expect, it } from 'vitest';
import parse_shared_path, {
    clear_share_recipient_param,
    shared_link_account_step,
    shared_link_recipient_uuid,
} from './parseSharedPath.js';

const UID = '11111111-2222-4333-8444-555555555555';

describe('parse_shared_path', () => {
    it('reads the owner, uuid and name a share link carries', () => {
        expect(parse_shared_path(`/alice/${UID}/report.txt`)).toEqual({
            owner: 'alice',
            uid: UID,
            name: 'report.txt',
        });
    });

    // A shared folder stays navigable, so the name can go deeper than one
    // segment once the recipient has opened into it.
    it('keeps a path below the shared root', () => {
        expect(parse_shared_path(`/alice/${UID}/dir/inner/file.txt`)).toEqual({
            owner: 'alice',
            uid: UID,
            name: 'dir/inner/file.txt',
        });
    });

    it('refuses anything that is not that shape', () => {
        // Not a path at all.
        expect(parse_shared_path('')).toBeNull();
        expect(parse_shared_path(undefined)).toBeNull();
        expect(parse_shared_path(42)).toBeNull();
        expect(parse_shared_path('alice/uuid/a.txt')).toBeNull();
        // A real path that merely looks similar.
        expect(parse_shared_path('/alice/Documents/a.txt')).toBeNull();
        // Truncated: the uuid addresses the parent, so there is nothing to open.
        expect(parse_shared_path(`/alice/${UID}`)).toBeNull();
        expect(parse_shared_path(`/alice/${UID}/`)).toBeNull();
        // Owner missing.
        expect(parse_shared_path(`//${UID}/a.txt`)).toBeNull();
        // Not a uuid.
        expect(parse_shared_path('/alice/not-a-uuid/a.txt')).toBeNull();
        expect(
            parse_shared_path(`/alice/${UID.replace('1', 'z')}/a.txt`),
        ).toBeNull();
    });
});

const CURRENT = '11111111-2222-4333-8444-555555555555';
const RECIPIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SHARED = `/alice/${UID}/report.txt`;

const share_params = (recipient = RECIPIENT, shared = SHARED) => {
    const params = new URLSearchParams();
    if ( shared !== null ) params.append('shared', shared);
    if ( recipient !== null ) params.set('user_uuid', recipient);
    return params;
};

describe('shared_link_recipient_uuid', () => {
    it('reads the recipient alongside a share path', () => {
        expect(shared_link_recipient_uuid(share_params())).toBe(RECIPIENT);
        expect(
            shared_link_recipient_uuid(share_params(RECIPIENT.toUpperCase())),
        ).toBe(RECIPIENT);
    });

    it('names no one without a share the GUI would open', () => {
        expect(shared_link_recipient_uuid(share_params(RECIPIENT, null)))
            .toBeNull();
        expect(shared_link_recipient_uuid(share_params(RECIPIENT, 'x')))
            .toBeNull();
        expect(shared_link_recipient_uuid(share_params(RECIPIENT, '')))
            .toBeNull();
    });

    it('refuses a hint that is not a uuid', () => {
        expect(shared_link_recipient_uuid(share_params('recipient')))
            .toBeNull();
        expect(shared_link_recipient_uuid(share_params(''))).toBeNull();
        expect(shared_link_recipient_uuid(share_params(null))).toBeNull();
    });
});

describe('shared_link_account_step', () => {
    const current = { uuid: CURRENT, username: 'me', auth_token: 't1' };
    const recipient = { uuid: RECIPIENT, username: 'them', auth_token: 't2' };
    const step = (overrides = {}) => shared_link_account_step({
        params: share_params(),
        current_user: current,
        logged_in_users: [current, recipient],
        ...overrides,
    });

    it('switches to the recipient when its session is saved', () => {
        expect(step()).toEqual({ switch_to: recipient });
    });

    it('asks when the recipient is not saved here', () => {
        expect(step({ logged_in_users: [current] })).toEqual({ ask: true });
        expect(step({
            logged_in_users: [current, { ...recipient, auth_token: '' }],
        })).toEqual({ ask: true });
    });

    it('does nothing when the recipient is already open', () => {
        expect(step({ params: share_params(CURRENT) })).toBeNull();
        expect(step({ params: share_params(CURRENT.toUpperCase()) }))
            .toBeNull();
    });

    it('does nothing without a usable hint', () => {
        expect(step({ params: share_params(null) })).toBeNull();
        expect(step({ params: share_params('recipient') })).toBeNull();
        expect(step({ params: share_params(RECIPIENT, null) })).toBeNull();
        expect(step({ params: share_params(RECIPIENT, 'x') })).toBeNull();
    });

    // A popup, embed or auth action belongs to whoever opened it; a link must
    // not choose its account.
    it('leaves popups, embeds and actions alone', () => {
        expect(step({ embedded: true })).toBeNull();
        expect(step({ action: 'sign-in' })).toBeNull();
        expect(step({ action: 'authme' })).toBeNull();
        expect(step({ action: 'login' })).toBeNull();
    });

    it('leaves a temporary session to the share link sign-in', () => {
        const temp = { uuid: CURRENT, is_temp: true };
        expect(step({ current_user: temp, logged_in_users: [temp] }))
            .toBeNull();
        // ...unless the recipient is saved, which beats asking to sign in.
        expect(step({ current_user: temp, logged_in_users: [temp, recipient] }))
            .toEqual({ switch_to: recipient });
    });
});

describe('clear_share_recipient_param', () => {
    const replaced = [];
    const at = (search, hash = '') => {
        replaced.length = 0;
        globalThis.document = { title: 't' };
        globalThis.window = {
            location: { pathname: '/', search, hash },
            history: { replaceState: (_s, _t, url) => replaced.push(url) },
            url_query_params: new URLSearchParams(search),
        };
    };

    afterEach(() => {
        delete globalThis.window;
        delete globalThis.document;
    });

    it('drops the hint and keeps the share', () => {
        const shared = encodeURIComponent(SHARED);
        at(`?shared=${shared}&user_uuid=${RECIPIENT}`, '#files');
        clear_share_recipient_param();
        expect(replaced).toEqual([`/?shared=${shared}#files`]);
        expect(window.url_query_params.has('user_uuid')).toBe(false);
        expect(window.url_query_params.get('shared')).toBe(SHARED);
    });

    it('leaves the address bar alone without a hint', () => {
        at('?shared=x');
        clear_share_recipient_param();
        expect(replaced).toEqual([]);
    });
});
