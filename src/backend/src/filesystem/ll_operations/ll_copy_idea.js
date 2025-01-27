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
/*

    This file describes an idea to make fine-grained
    steps of a filesystem operation more declarative.

    This could have advantages like:
    - easier tracking of side-effects
    - steps automatically mark checkpoints
    - steps automatically have tracing
    - implications of re-ordering steps would
      always be known
    - easier to diagnose stuck operations

*/
/* eslint-disable */

const STEPS_COPY_CONTENTS = [
    {
        id: 'add storage info to fsentry',
        behaviour: 'none',
        fn: async ({ util, values }) => {
            const { source } = values;
            // "util.assign" makes it possible to
            // track changes caused by this step
            util.assign('raw_fsentry', {
                size: source.entry.size,
                // ...
            })
        }
    },
    {
        id: 'create progress tracker',
        behaviour: 'values',
        fn: async () => {
            const progress_tracker =
                new UploadProgressTracker();
            return {
                progress_tracker
            };
        }
    },
    {
        id: 'emit copy progress event',
        behaviour: 'side-effect',
        fn: async ({ services }) => {
            services.event.emit(
                /// ...
            )
        }
    },
    {
        id: 'get storage backend',
        behaviour: 'values',
        fn: async ({ services }) => {
            const storage = new
                PuterS3StorageStrategy({
                    services
                })
            return { storage };
        }
    },
    // ...
]

const STEPS = [
    {
        id: 'generate uuid and ts',
        behaviour: 'values',
        fn: async ({ modules }) => {
            return {
                uuid: modules.uuidv4(),
                ts: Math.round(Date.now()/1000)
            };
        }
    },
    {
        id: 'redundancy fetch',
        behaviour: 'side-effect',
        fn: async ({ values }) => {
            await values.source.fetchEntry({
                thumbnail: true,
            });
            await values.parent.fetchEntry();
        }
    },
    {
        id: 'generate raw fsentry',
        behaviour: 'values',
        fn: async ({ values }) => {
            const {
                source,
                parent, target_name,
                uuid, ts,
                user,
            } = values;
            const raw_fsentry = {
                uuid,
                is_dir: source.entry.is_dir,
                // ...
            };
            return { raw_fsentry };
        }
    },
    {
        id: 'emit fs.pending.file',
        fn: () => {
            // ...
        }
    },
    {
        id: 'copy contents',
        cond: async ({ values }) => {
            return await values.source.get('has-s3');
        },
        steps: STEPS_COPY_CONTENTS,
    },
    // ...
]

class LLCopy extends LLFilesystemOperation {
    static STEPS = STEPS
}
