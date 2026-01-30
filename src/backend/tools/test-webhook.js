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

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_PATH = path.join(__dirname, '.test-webhook-config.json');

function randomHex (bytes) {
    return crypto.randomBytes(bytes).toString('hex');
}

function loadConfig () {
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const data = JSON.parse(raw);
        if ( data && typeof data.key === 'string' && typeof data.webhook_secret === 'string' ) {
            const out = {
                key: data.key,
                webhook_secret: data.webhook_secret,
                nonce: typeof data.nonce === 'number' ? data.nonce : 0,
            };
            if ( typeof data.instance_url === 'string' && data.instance_url.trim() !== '' ) {
                out.instance_url = data.instance_url.trim().replace(/\/+$/, '');
            }
            return out;
        }
    } catch (e) {
        const is_not_found = e.code === 'ENOENT';
        if ( ! is_not_found ) {
            console.error('Saved config exists but could not be read:', e);
        }
    }
    return null;
}

/**
 * Saves a dotfile beside the script so new configuration doesn't need to be
 * re-entered into Puter every time this script is used.
 * @param {*} peerId - The peer ID to save.
 * @param {*} webhookSecret - The webhook secret to save.
 * @param {*} nonce - The nonce to save.
 * @param {*} instanceUrl - The instance URL to save.
 */
function saveConfig (peerId, webhookSecret, nonce, instanceUrl) {
    const payload = {
        key: peerId,
        webhook_secret: webhookSecret,
        nonce,
    };
    if ( typeof instanceUrl === 'string' && instanceUrl.trim() !== '' ) {
        payload.instance_url = instanceUrl.trim().replace(/\/+$/, '');
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * This wrapper around readline.question is used to promisify the interface
 * and remove whitespace from the input.
 *
 * @param {*} rl
 * @param {*} question
 * @param {*} defaultAnswer
 * @returns {Promise<string>} - The trimmed answer.
 */
function ask (rl, question, defaultAnswer = '') {
    const prompt = defaultAnswer ? `${question} [${defaultAnswer}]: ` : `${question} `;
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
            const trimmed = answer.trim();
            resolve(trimmed !== '' ? trimmed : defaultAnswer);
        });
    });
}

async function main () {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    let peerId;
    let webhookSecret;
    let nonce;
    const existing = loadConfig();

    if ( existing ) {
        const useExisting = await ask(rl, 'Existing key found. Use it? (y/n)', 'y');
        const noAnswers = ['n', 'no'];
        if ( noAnswers.includes(useExisting.toLowerCase()) ) {
            peerId = `test-webhook-${randomHex(8)}`;
            webhookSecret = randomHex(32);
            nonce = 0;
            saveConfig(peerId, webhookSecret, nonce, existing.instance_url);
            console.log('');
            console.log('New key generated.');
            console.log('');
            console.log('Add the following peer to your Puter instance config so it can accept');
            console.log('webhooks from this test script. In your config file (e.g. config.json),');
            console.log('under the "broadcast" section, add a "peers" array (if missing) and');
            console.log('include this entry:');
            console.log('');
            console.log(JSON.stringify({
                key: peerId,
                webhook_secret: webhookSecret,
            }, null, 2));
            console.log('');
            console.log('Example config structure:');
            console.log('  "broadcast": {');
            console.log('    "peers": [');
            console.log('      { "key": "<above key>", "webhook_secret": "<above secret>" }');
            console.log('    ]');
            console.log('  }');
            console.log('');
            console.log('Restart your Puter instance after updating the config.');
            console.log('');
        } else {
            peerId = existing.key;
            webhookSecret = existing.webhook_secret;
            nonce = existing.nonce;
            console.log('');
            console.log('Using existing key:', peerId);
            console.log('');
        }
    } else {
        peerId = `test-webhook-${randomHex(8)}`;
        webhookSecret = randomHex(32);
        nonce = 0;
        saveConfig(peerId, webhookSecret, nonce, undefined);
        console.log('');
        console.log('Add the following peer to your Puter instance config so it can accept');
        console.log('webhooks from this test script. In your config file (e.g. config.json),');
        console.log('under the "broadcast" section, add a "peers" array (if missing) and');
        console.log('include this entry:');
        console.log('');
        console.log(JSON.stringify({
            key: peerId,
            webhook_secret: webhookSecret,
        }, null, 2));
        console.log('');
        console.log('Example config structure:');
        console.log('  "broadcast": {');
        console.log('    "peers": [');
        console.log('      { "key": "<above key>", "webhook_secret": "<above secret>" }');
        console.log('    ]');
        console.log('  }');
        console.log('');
        console.log('Restart your Puter instance after updating the config.');
        console.log('');
    }

    const defaultUrl = existing && existing.instance_url ? existing.instance_url : '';
    const baseUrl = await ask(rl, 'Instance base URL (e.g. http://api.puter.localhost:4100)', defaultUrl);
    const url = baseUrl.trim().replace(/\/+$/, '');
    if ( ! url ) {
        console.error('Please provide a URL.');
        rl.close();
        process.exit(1);
    }

    const webhookUrl = `${url}/broadcast/webhook`;
    const timestamp = Math.floor(Date.now() / 1000);
    const body = {
        key: 'test',
        data: { contents: 'I am a test message from test-webhook.js' },
        meta: {},
    };
    const rawBody = JSON.stringify(body);
    const payloadToSign = `${timestamp}.${nonce}.${rawBody}`;
    const signature = crypto.createHmac('sha256', webhookSecret).update(payloadToSign).digest('hex');

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Broadcast-Peer-Id': peerId,
                'X-Broadcast-Timestamp': String(timestamp),
                'X-Broadcast-Nonce': String(nonce),
                'X-Broadcast-Signature': signature,
            },
            body: rawBody,
        });

        rl.close();

        if ( res.ok ) {
            saveConfig(peerId, webhookSecret, nonce + 1, url);
            console.log('');
            console.log('Test event sent successfully. Status:', res.status);
            const text = await res.text();
            if ( text ) console.log('Response:', text);
            process.exit(0);
        } else {
            const text = await res.text();
            console.error('');
            console.error('Request failed. Status:', res.status, res.statusText);
            if ( text ) console.error('Response:', text);
            process.exit(1);
        }
    } catch ( err ) {
        rl.close();
        console.error('');
        console.error('Request failed:', err.message);
        process.exit(1);
    }
}

main();
