import assert from 'assert';
import { privacy_aware_path } from '../src/util/desktop.js';

const cases = [
    {
        title: 'path in user home',
        username: 'user',
        input: '/home/user/test.txt',
        expected: '~/test.txt',
    },
    {
        title: 'path on user desktop',
        username: 'user',
        input: '/home/user/Desktop/test.txt',
        expected: '~/Desktop/test.txt',
    },
    {
        title: 'prefix (ed3/ed) bug',
        username: 'ed',
        input: '/home/ed3/Desktop/test.txt',
        expected: '/home/ed3/Desktop/test.txt',
    },
];

describe('window.privacy_aware_path', () => {
    for (const { title, username, input, expected } of cases) {
        it(title, () => {
            assert.equal(privacy_aware_path({
                window: { home_path: `/home/${username}` },
            })(input), expected);
        });
    }
});