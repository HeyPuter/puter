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

const check_password_strength = (password) => {
    // Define criteria for password strength
    const criteria = {
        minLength: 8,
        hasUpperCase: /[A-Z]/.test(password),
        hasLowerCase: /[a-z]/.test(password),
        hasNumber: /\d/.test(password),
        hasSpecialChar: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password),
    };

    let overallPass = true;

    // Initialize report object
    let criteria_report = {
        minLength: {
            message: `Password must be at least ${criteria.minLength} characters long`,
            pass: password.length >= criteria.minLength,
        },
        hasUpperCase: {
            message: 'Password must contain at least one uppercase letter',
            pass: criteria.hasUpperCase,
        },
        hasLowerCase: {
            message: 'Password must contain at least one lowercase letter',
            pass: criteria.hasLowerCase,
        },
        hasNumber: {
            message: 'Password must contain at least one number',
            pass: criteria.hasNumber,
        },
        hasSpecialChar: {
            message: 'Password must contain at least one special character',
            pass: criteria.hasSpecialChar,
        },
    };

    // Check overall pass status and add messages
    for ( let criterion in criteria ) {
        if ( ! criteria_report[criterion].pass ) {
            overallPass = false;
            break;
        }
    }

    return {
        overallPass: overallPass,
        report: criteria_report,
    };
};

export default check_password_strength;
