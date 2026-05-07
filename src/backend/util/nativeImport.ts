/**
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

// `new Function('return import(s)')` would defeat any static bundler
// analysis, but the resulting function inherits a vm context with no
// HostImportModuleDynamically callback under vitest, which throws
// ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING. A direct `import()` with
// `@vite-ignore` accomplishes the same thing — vite skips analysis,
// node performs the import — and works in tests.
export const nativeImport = <TModule = unknown>(
    specifier: string,
): Promise<TModule> => import(/* @vite-ignore */ specifier) as Promise<TModule>;
