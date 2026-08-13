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
 * Whether an app's window should start hidden: either the app always runs
 * without one (`background` on the app itself), or this particular launch asked
 * for one (`puter.ui.launchApp(name, args, { background: true })`), which lets a
 * dual-purpose app serve another app without a window flashing on screen.
 *
 * A background *launch* keeps its taskbar item, so the user can see that it is
 * running, show it, or close it; an app that is always windowless has none.
 *
 * @param {{ background?: boolean }} [appInfo] the app record being launched
 * @param {{ background?: boolean }} [options] this launch's options
 * @returns {boolean}
 */
export const starts_hidden = (appInfo, options) => {
    return Boolean(appInfo?.background) || options?.background === true;
};
