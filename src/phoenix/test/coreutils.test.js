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
import { runBasenameTests } from './coreutils/basename.js';
import { runDateTests } from './coreutils/date.js';
import { runDirnameTests } from './coreutils/dirname.js';
import { runEchoTests } from './coreutils/echo.js';
import { runEnvTests } from './coreutils/env.js';
import { runErrnoTests } from './coreutils/errno.js';
import { runFalseTests } from './coreutils/false.js';
import { runHeadTests } from './coreutils/head.js';
import { runPrintfTests } from './coreutils/printf.js';
import { runSleepTests } from './coreutils/sleep.js';
import { runSortTests } from './coreutils/sort.js';
import { runTailTests } from './coreutils/tail.js';
import { runTrueTests } from './coreutils/true.js';
import { runWcTests } from './coreutils/wc.js';

describe('coreutils', function () {
    runBasenameTests();
    runDateTests();
    runDirnameTests();
    runEchoTests();
    runEnvTests();
    runErrnoTests();
    runFalseTests();
    runHeadTests();
    runPrintfTests();
    runSleepTests();
    runSortTests();
    runTailTests();
    runTrueTests();
    runWcTests();
});
