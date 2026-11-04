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

import UIAlert from '../UI/UIAlert.js';
import UIWindowProgress from '../UI/UIWindowProgress.js';

/**
 * Save the file at `url` into the user's Desktop folder once they confirm,
 * with a progress window that can cancel it. Backs `/?download=<url>` links.
 *
 * @param {string} url
 * @returns {Promise<void>} settles once the user has answered the prompt;
 *     the download itself carries on in the background
 */
const download_url_to_desktop = async (url) => {
    const file_name = url.split('/').pop().split('?')[0];

    const confirmed = await UIAlert({
        message: i18n('confirm_download_file_to_desktop', file_name),
        type: 'confirm',
        buttons: [
            { label: i18n('alert_yes'), value: true, type: 'primary' },
            { label: i18n('alert_no'), value: false, type: 'secondary' },
        ],
    });
    if ( ! confirmed ) return;

    let cancelled = false;
    let upload_xhr = null;
    const abort_controller = new AbortController();

    const progwin = await UIWindowProgress({
        title: i18n('downloading'),
        icon: window.icons['app-icon-uploader.svg'],
        operation_id: window.uuidv4(),
        show_progress: true,
        on_cancel: () => {
            cancelled = true;
            abort_controller.abort();
            if ( upload_xhr ) {
                upload_xhr.abort();
            }
        },
    });
    progwin?.set_status(i18n('downloading_file', file_name));

    (async () => {
        try {
            const response = await puter.net.fetch(url, {
                signal: abort_controller.signal,
            });

            const total = Number(response.headers.get('content-length'));
            const reader = response.body.getReader();

            const chunks = [];
            let received = 0;

            while ( true ) {
                const { done, value } = await reader.read();
                if ( done || cancelled ) break;

                if ( value ) {
                    chunks.push(value);
                    received += value.length;
                    const progress = Number.isFinite(total) && total > 0
                        ? received / total
                        : 0;
                    progwin?.set_progress(Math.floor(progress * 100));
                }
            }

            if ( cancelled ) {
                progwin?.close();
                return;
            }

            const blob = new Blob(chunks, {
                type: response.headers.get('content-type') ?? 'application/octet-stream',
            });

            progwin?.set_progress(0);
            progwin?.set_status(i18n('uploading_file', file_name));

            await puter.fs.write(`~/Desktop/${file_name}`, blob, {
                dedupeName: true,
                progress: (_, percent) => {
                    progwin?.set_progress(percent);
                },
                init: (_, xhr) => {
                    upload_xhr = xhr;
                },
            });
        } catch (e) {
            // A cancel aborts the fetch; only a real failure is worth reporting.
            if ( !cancelled && e.name !== 'AbortError' ) {
                await UIAlert({
                    message: `${i18n('error_download_failed')}: ${e.message}`,
                    type: 'error',
                });
            }
        }
        progwin?.close();
    })();
};

export default download_url_to_desktop;
