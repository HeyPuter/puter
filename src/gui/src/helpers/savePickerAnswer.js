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
 * Tracks one save picker so its caller hears exactly one answer: fileSaved,
 * or fileSaveCancelled (sent through `cancelled`) when the picker goes away
 * without saving.
 *
 * @param {{ cancelled: () => void }} options
 */
export default function createSavePickerAnswer ({ cancelled }) {
    let answered = false;
    let closed = false;
    let saving = false;
    // Set from the start of a write until the caller hears its outcome;
    // closing the picker meanwhile doesn't answer for it.
    let writing = false;
    const download = new AbortController();

    const cancel = () => {
        if ( answered ) return;
        answered = true;
        cancelled();
    };

    return {
        /** Aborts when the picker closes. */
        signal: download.signal,
        get answered () {
            return answered;
        },
        cancel,
        /** Whether the caller should hear fileSaved; false once it heard anything. */
        saved () {
            if ( answered ) return false;
            answered = true;
            return true;
        },
        close () {
            closed = true;
            download.abort();
            if ( ! writing ) cancel();
        },
        /** False while a save runs (Enter can fire another) or after the answer. */
        startSave () {
            if ( saving || answered ) return false;
            saving = true;
            return true;
        },
        endSave () {
            saving = false;
        },
        /**
         * Runs a write unless the caller was already answered, resolving to
         * undefined then. A write that fails after the picker closed answers
         * cancelled instead of throwing.
         *
         * @template T
         * @param {() => Promise<T>} run
         * @returns {Promise<T | undefined>}
         */
        async write (run) {
            if ( answered ) return;
            writing = true;
            try {
                return await run();
            } catch ( err ) {
                writing = false;
                if ( ! closed ) throw err;
                cancel();
            }
        },
    };
}

/**
 * Signs a just-written file for the app that asked to save it. The file
 * exists by now, so one failure is retried before giving up.
 *
 * @param {string} appUid
 * @param {string} uid
 */
export async function signSavedFile (appUid, uid) {
    try {
        return await puter.fs.sign(appUid, { uid, action: 'write' });
    } catch {
        return await puter.fs.sign(appUid, { uid, action: 'write' });
    }
}
