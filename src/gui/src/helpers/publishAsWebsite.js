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

import UIWindowPublishWebsite from '../UI/UIWindowPublishWebsite.js';
import ensure_can_publish from './ensureCanPublish.js';

/**
 * Opens the "Publish as website" flow for a directory, first walking the user
 * through account creation and email confirmation when the deployment requires
 * a verified email to publish. Returns without publishing if the user backs out
 * of either step.
 *
 * @param {Object} dir - The directory to publish
 * @param {string} dir.uid - UID of the directory
 * @param {string} dir.name - Display name of the directory
 * @param {string} dir.path - Full path of the directory
 * @returns {Promise<void>}
 */
const publish_as_website = async function ({ uid, name, path }) {
    if ( ! await ensure_can_publish(window.require_email_verification_to_publish_website) ) return;
    await UIWindowPublishWebsite(uid, name, path);
};

export default publish_as_website;
