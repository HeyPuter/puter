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

import UIWindow from './UIWindow.js';
import UIQRCode from './UIQRCode.js';

// ── CSS (injected once) ─────────────────────────────────────────────────────
const CSS = `
.tfa-setup {
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a2233;
    user-select: none;
    -webkit-user-select: none;
}

/* ── Progress bar ──────────────────────────────────────────────────────── */
.tfa-progress {
    display: flex;
    align-items: center;
    margin-bottom: 28px;
}
.tfa-progress-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    min-width: 0;
}
.tfa-progress-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    font-weight: 600;
    border: 2px solid #d0d5dd;
    color: #98a2b3;
    background: #fff;
    transition: all 0.25s ease;
    flex-shrink: 0;
}
.tfa-progress-dot.active {
    border-color: #3b82f6;
    background: #3b82f6;
    color: #fff;
}
.tfa-progress-dot.done {
    border-color: #22c55e;
    background: #22c55e;
    color: #fff;
}
.tfa-progress-label {
    font-size: 11px;
    font-weight: 500;
    color: #98a2b3;
    text-align: center;
    transition: color 0.25s ease;
    max-width: 80px;
    line-height: 1.3;
}
.tfa-progress-label.active {
    color: #1a2233;
}
.tfa-progress-line {
    flex: 1;
    height: 2px;
    background: #e5e7eb;
    margin: 0 8px;
    margin-bottom: 22px;
    position: relative;
    min-width: 20px;
}
.tfa-progress-line-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 0%;
    background: #22c55e;
    transition: width 0.4s ease;
}

/* ── Screens ───────────────────────────────────────────────────────────── */
.tfa-screen {
    display: none;
    flex-direction: column;
    animation: tfa-fade-in 0.3s ease;
}
.tfa-screen.active {
    display: flex;
}
@keyframes tfa-fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* ── Screen 1: QR + Code ───────────────────────────────────────────── */
.tfa-instruction {
    font-size: 14px;
    line-height: 1.6;
    color: #475569;
    margin-bottom: 20px;
}
.tfa-qr-area {
    display: flex;
    justify-content: center;
    padding: 16px 0 20px;
}
.tfa-qr-area .qr-code {
}
.tfa-qr-area .qr-code img {
    margin-bottom: 0 !important;
}
.tfa-secret-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 24px;
}
.tfa-secret-key {
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 13px;
    letter-spacing: 1.5px;
    color: #475569;
    background: #f1f5f9;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
}
.tfa-copy-secret {
    background: none;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 5px 8px;
    cursor: pointer;
    color: #64748b;
    display: flex;
    align-items: center;
    transition: all 0.15s ease;
}
.tfa-copy-secret:hover {
    background: #f1f5f9;
    color: #334155;
}
.tfa-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
}
.tfa-divider::before,
.tfa-divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: #e5e7eb;
}
.tfa-divider span {
    font-size: 12px;
    font-weight: 500;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

/* ── Code input ────────────────────────────────────────────────────── */
.tfa-code-section label {
    display: block;
    font-size: 13px;
    font-weight: 600;
    color: #334155;
    margin-bottom: 8px;
}
.tfa-code-inputs {
    display: flex;
    gap: 8px;
    justify-content: center;
    margin-bottom: 8px;
}
.tfa-code-inputs input {
    width: 44px;
    height: 52px;
    text-align: center;
    font-size: 22px;
    font-weight: 600;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    border: 2px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
    color: #1a2233;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    caret-color: #3b82f6;
    -moz-appearance: textfield;
}
.tfa-code-inputs input::-webkit-outer-spin-button,
.tfa-code-inputs input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
.tfa-code-inputs input:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
}
.tfa-code-inputs input.error {
    border-color: #ef4444;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
    animation: tfa-shake 0.4s ease;
}
@keyframes tfa-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-4px); }
    40% { transform: translateX(4px); }
    60% { transform: translateX(-3px); }
    80% { transform: translateX(2px); }
}
.tfa-code-error {
    font-size: 13px;
    color: #ef4444;
    text-align: center;
    min-height: 20px;
    margin-bottom: 4px;
}
.tfa-code-spinner {
    display: none;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    font-size: 13px;
    color: #64748b;
}
.tfa-code-spinner.visible {
    display: flex;
}
.tfa-spinner-icon {
    width: 16px;
    height: 16px;
    border: 2px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: tfa-spin 0.6s linear infinite;
}
@keyframes tfa-spin {
    to { transform: rotate(360deg); }
}

/* ── Screen 2: Recovery codes ──────────────────────────────────────── */
.tfa-recovery-intro {
    font-size: 14px;
    line-height: 1.6;
    color: #475569;
    margin-bottom: 16px;
}
.tfa-recovery-warning {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 10px;
    margin-bottom: 20px;
    font-size: 13px;
    line-height: 1.5;
    color: #92400e;
}
.tfa-recovery-warning svg {
    flex-shrink: 0;
    margin-top: 1px;
}
.tfa-codes-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 20px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.tfa-codes-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    padding: 4px 0;
}
.tfa-codes-grid .tfa-code-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 14px;
    letter-spacing: 1px;
    color: #1e293b;
}
.tfa-code-item-idx {
    font-size: 11px;
    color: #94a3b8;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    min-width: 16px;
}
.tfa-codes-actions {
    display: flex;
    border-top: 1px solid #e2e8f0;
}
.tfa-codes-actions button {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    font-size: 13px;
    font-weight: 500;
    color: #3b82f6;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.15s ease;
}
.tfa-codes-actions button:hover {
    background: #f8fafc;
}
.tfa-codes-actions button + button {
    border-left: 1px solid #e2e8f0;
}
.tfa-codes-actions button.copied {
    color: #22c55e;
}

/* ── Checkboxes ────────────────────────────────────────────────────── */
.tfa-confirmations {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
}
.tfa-confirm-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
}
.tfa-confirm-item input[type="checkbox"] {
    appearance: none;
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    border: 2px solid #d0d5dd;
    border-radius: 6px;
    flex-shrink: 0;
    margin-top: 1px;
    cursor: pointer;
    position: relative;
    transition: all 0.15s ease;
    background: #fff;
}
.tfa-confirm-item input[type="checkbox"]:checked {
    background: #3b82f6;
    border-color: #3b82f6;
}
.tfa-confirm-item input[type="checkbox"]:checked::after {
    content: '';
    position: absolute;
    left: 5px;
    top: 2px;
    width: 6px;
    height: 10px;
    border: solid #fff;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
}
.tfa-confirm-item label {
    font-size: 14px;
    color: #475569;
    line-height: 1.5;
    cursor: pointer;
}

/* ── Buttons ───────────────────────────────────────────────────────── */
.tfa-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 12px 24px;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
    outline: none;
    width: 100%;
}
.tfa-btn-primary {
    background: #3b82f6;
    color: #fff;
    box-shadow: 0 1px 2px rgba(59, 130, 246, 0.3);
}
.tfa-btn-primary:hover:not(:disabled) {
    background: #2563eb;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
}
.tfa-btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.tfa-btn-success {
    background: #22c55e;
    color: #fff;
    box-shadow: 0 1px 2px rgba(34, 197, 94, 0.3);
}
.tfa-btn-success:hover {
    background: #16a34a;
}

/* ── Screen 3: Success ─────────────────────────────────────────────── */
.tfa-success-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #ecfdf5;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 8px auto 20px;
    animation: tfa-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
@keyframes tfa-pop {
    0% { transform: scale(0); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
}
.tfa-success-title {
    font-size: 20px;
    font-weight: 700;
    color: #1a2233;
    text-align: center;
    margin-bottom: 8px;
}
.tfa-success-text {
    font-size: 14px;
    color: #64748b;
    text-align: center;
    line-height: 1.6;
    margin-bottom: 28px;
}

/* ── Responsive ────────────────────────────────────────────────────── */

/* Small window width (container query via the window class) */
@media (max-width: 540px) {
    .window-tfa-setup {
        width: calc(100vw - 24px) !important;
        left: 12px !important;
        max-height: calc(100vh - 24px);
    }
    .window-tfa-setup .window-body {
        padding: 20px 16px 18px !important;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
    }
    .tfa-progress {
        margin-bottom: 20px;
    }
    .tfa-qr-area {
        padding: 10px 0 14px;
    }
    .tfa-qr-area .qr-code img,
    .tfa-qr-area .qr-code canvas {
        max-width: 140px !important;
        max-height: 140px !important;
        width: 140px !important;
        height: 140px !important;
    }
    .tfa-secret-row {
        margin-bottom: 16px;
    }
    .tfa-secret-key {
        font-size: 11px;
        letter-spacing: 1px;
        padding: 5px 8px;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
    }
    .tfa-code-inputs {
        gap: 6px;
    }
    .tfa-code-inputs input {
        width: 38px;
        height: 46px;
        font-size: 19px;
        border-radius: 8px;
    }
    .tfa-instruction {
        font-size: 13px;
        margin-bottom: 14px;
    }
    .tfa-divider {
        margin-bottom: 14px;
    }
    .tfa-codes-grid .tfa-code-item {
        padding: 8px 12px;
        font-size: 12px;
        letter-spacing: 0.5px;
    }
    .tfa-recovery-warning {
        font-size: 12px;
        padding: 10px 12px;
    }
    .tfa-confirmations {
        margin-bottom: 18px;
    }
    .tfa-confirm-item label {
        font-size: 13px;
    }
    .tfa-btn {
        padding: 11px 20px;
        font-size: 13px;
    }
    .tfa-success-icon {
        width: 52px;
        height: 52px;
    }
    .tfa-success-title {
        font-size: 18px;
    }
    .tfa-success-text {
        font-size: 13px;
        margin-bottom: 20px;
    }
}

/* Very small phones */
@media (max-width: 380px) {
    .window-tfa-setup {
        width: 100vw !important;
        left: 0 !important;
        border-radius: 0 !important;
    }
    .tfa-code-inputs input {
        width: 34px;
        height: 42px;
        font-size: 17px;
        gap: 4px;
    }
    .tfa-codes-grid {
        grid-template-columns: 1fr;
    }
    .tfa-progress-label {
        font-size: 10px;
    }
}
`;

let css_injected = false;
const inject_css_ = () => {
    if ( css_injected ) return;
    css_injected = true;
    $('<style/>').text(CSS).appendTo('head');
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const SVG_CHECK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const SVG_COPY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const SVG_PRINT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`;

const SVG_WARN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const SVG_SHIELD_CHECK = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>`;

/**
 * Extract the TOTP secret from an otpauth:// URL for manual entry.
 */
function extract_secret (url) {
    try {
        const u = new URL(url);
        return u.searchParams.get('secret') || '';
    } catch {
        return '';
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const UIWindow2FASetup = async function UIWindow2FASetup () {
    inject_css_();

    let resolve_promise;
    const promise = new Promise(r => { resolve_promise = r; });
    let setup_succeeded = false;

    // ── API helpers ──────────────────────────────────────────────────────
    const api = (endpoint, body = {}) => fetch(
        `${window.api_origin}/auth/configure-2fa/${endpoint}`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${puter.authToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        },
    ).then(r => r.json());

    // FIRST REQUEST: generate QR code + recovery codes
    const data = await api('setup');
    const secret = extract_secret(data.url);

    // ── QR code mount point ────────────────────────────────────────────
    const qr_id = 'tfa-qr-' + (window.global_element_id = (window.global_element_id || 0) + 1);

    // ── Build HTML ───────────────────────────────────────────────────────
    let h = '';
    h += '<div class="tfa-setup">';

    // ── Progress bar ─────────────────────────────────────────────────────
    h += '<div class="tfa-progress">';
    h += '  <div class="tfa-progress-step">';
    h += '    <div class="tfa-progress-dot active" data-step="1">1</div>';
    h += '    <span class="tfa-progress-label active">Scan</span>';
    h += '  </div>';
    h += '  <div class="tfa-progress-line"><div class="tfa-progress-line-fill"></div></div>';
    h += '  <div class="tfa-progress-step">';
    h += '    <div class="tfa-progress-dot" data-step="2">2</div>';
    h += '    <span class="tfa-progress-label">Backup</span>';
    h += '  </div>';
    h += '  <div class="tfa-progress-line"><div class="tfa-progress-line-fill"></div></div>';
    h += '  <div class="tfa-progress-step">';
    h += `    <div class="tfa-progress-dot" data-step="3">${SVG_CHECK}</div>`;
    h += '    <span class="tfa-progress-label">Done</span>';
    h += '  </div>';
    h += '</div>';

    // ── Screen 1: Scan QR + Enter Code ───────────────────────────────────
    h += '<div class="tfa-screen active" data-screen="1">';
    h += `<p class="tfa-instruction">${i18n('setup2fa_1_instructions', [], false)}</p>`;
    h += `<div class="tfa-qr-area"><div id="${qr_id}"></div></div>`;

    // Manual secret key
    if ( secret ) {
        h += '<div class="tfa-secret-row">';
        h += `  <span class="tfa-secret-key">${html_encode(secret)}</span>`;
        h += `  <button class="tfa-copy-secret" title="Copy secret key">${SVG_COPY}</button>`;
        h += '</div>';
    }

    h += '<div class="tfa-divider"><span>' + html_encode(i18n('setup2fa_3_step_heading')) + '</span></div>';

    h += '<div class="tfa-code-section">';
    h += '  <div class="tfa-code-inputs">';
    for ( let i = 0; i < 6; i++ ) {
        h += `<input type="text" inputmode="numeric" maxlength="1" autocomplete="off" data-idx="${i}" />`;
    }
    h += '  </div>';
    h += '  <div class="tfa-code-error"></div>';
    h += `  <div class="tfa-code-spinner"><div class="tfa-spinner-icon"></div><span>Verifying...</span></div>`;
    h += '</div>';
    h += '</div>'; // end screen 1

    // ── Screen 2: Recovery Codes ─────────────────────────────────────────
    h += '<div class="tfa-screen" data-screen="2">';
    h += `<p class="tfa-recovery-intro">${i18n('setup2fa_4_instructions', [], false)}</p>`;
    h += '<div class="tfa-recovery-warning">';
    h += `  ${SVG_WARN}`;
    h += '  <span>These codes can only be viewed once. Store them in a safe place &mdash; you will need them if you lose access to your authenticator app.</span>';
    h += '</div>';

    h += '<div class="tfa-codes-card">';
    h += '  <div class="tfa-codes-grid">';
    data.codes.forEach((code, i) => {
        h += `<div class="tfa-code-item"><span class="tfa-code-item-idx">${i + 1}.</span>${html_encode(code)}</div>`;
    });
    h += '  </div>';
    h += '  <div class="tfa-codes-actions">';
    h += `    <button class="tfa-copy-codes">${SVG_COPY} <span>${html_encode(i18n('copy'))}</span></button>`;
    h += `    <button class="tfa-print-codes">${SVG_PRINT} <span>${html_encode(i18n('print'))}</span></button>`;
    h += '  </div>';
    h += '</div>';

    h += '<iframe class="tfa-print-frame" name="tfa_print_frame" width="0" height="0" frameborder="0" src="about:blank" style="display:none;"></iframe>';

    h += '<div class="tfa-confirmations">';
    h += '  <div class="tfa-confirm-item">';
    h += '    <input type="checkbox" id="tfa-confirm-saved" />';
    h += `    <label for="tfa-confirm-saved">${html_encode(i18n('setup2fa_5_confirmation_1'))}</label>`;
    h += '  </div>';
    h += '  <div class="tfa-confirm-item">';
    h += '    <input type="checkbox" id="tfa-confirm-ready" />';
    h += `    <label for="tfa-confirm-ready">${html_encode(i18n('setup2fa_5_confirmation_2'))}</label>`;
    h += '  </div>';
    h += '</div>';

    h += `<button class="tfa-btn tfa-btn-primary tfa-enable-btn" disabled>${html_encode(i18n('setup2fa_5_button'))}</button>`;
    h += '</div>'; // end screen 2

    // ── Screen 3: Success ────────────────────────────────────────────────
    h += '<div class="tfa-screen" data-screen="3">';
    h += `<div class="tfa-success-icon">${SVG_SHIELD_CHECK}</div>`;
    h += `<div class="tfa-success-title">${html_encode(i18n('two_factor_enabled'))}</div>`;
    h += '<p class="tfa-success-text">Your account is now protected with two-factor authentication. You\'ll be asked for a verification code each time you sign in.</p>';
    h += `<button class="tfa-btn tfa-btn-success tfa-done-btn">Done</button>`;
    h += '</div>'; // end screen 3

    h += '</div>'; // end tfa-setup

    // ── Create window ────────────────────────────────────────────────────
    const el_window = await UIWindow({
        title: null,
        app: 'tfa-setup',
        single_instance: true,
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        has_head: false,
        selectable_body: true,
        draggable_body: false,
        allow_context_menu: false,
        is_resizable: false,
        is_droppable: false,
        init_center: true,
        allow_native_ctxmenu: false,
        allow_user_select: true,
        width: Math.min(480, window.innerWidth - 24),
        height: 'auto',
        dominant: true,
        show_in_taskbar: false,
        is_draggable: false,
        backdrop: true,
        on_before_exit: async () => {
            if ( ! setup_succeeded ) resolve_promise(false);
            return true;
        },
        window_class: 'window-tfa-setup',
        body_css: {
            width: 'initial',
            height: '100%',
            'max-height': 'calc(100vh - 40px)',
            'overflow-y': 'auto',
            '-webkit-overflow-scrolling': 'touch',
            'background-color': '#f8fafc',
            'backdrop-filter': 'blur(3px)',
            padding: '28px 28px 24px',
        },
        onAppend: function (el_win) {
            requestAnimationFrame(() => {
                const $win = $(el_win);
                const wh = $win.outerHeight();
                const parent_h = $win.parent().height() || window.innerHeight;
                $win.css('top', Math.max(0, (parent_h - wh) / 2) + 'px');
            });
        },
    });

    // ── Render QR code ─────────────────────────────────────────────────
    UIQRCode({
        value: data.url,
        size: 180,
        appendTo: document.getElementById(qr_id),
    });

    const $w = $(el_window);

    // ── Screen navigation ────────────────────────────────────────────────
    function go_to_screen (n) {
        $w.find('.tfa-screen').removeClass('active');
        $w.find(`.tfa-screen[data-screen="${n}"]`).addClass('active');

        // Update progress dots & labels
        $w.find('.tfa-progress-dot').each(function () {
            const step = parseInt($(this).attr('data-step'));
            $(this).removeClass('active done');
            $w.find('.tfa-progress-label').eq(
                $(this).parent().index() / 2  // steps are at even indices
            ).removeClass('active');

            if ( step < n ) $(this).addClass('done');
            else if ( step === n ) $(this).addClass('active');
        });
        $w.find('.tfa-progress-step').each(function (idx) {
            const $label = $(this).find('.tfa-progress-label');
            const $dot = $(this).find('.tfa-progress-dot');
            $label.toggleClass('active', $dot.hasClass('active') || $dot.hasClass('done'));
        });

        // Update progress lines
        $w.find('.tfa-progress-line').each(function (idx) {
            const fill = $(this).find('.tfa-progress-line-fill');
            fill.css('width', idx < n - 1 ? '100%' : '0%');
        });

        // Focus first code input on screen 1
        if ( n === 1 ) {
            setTimeout(() => $w.find('.tfa-code-inputs input').first().focus(), 100);
        }
    }

    // ── Code input handling ──────────────────────────────────────────────
    const $inputs = $w.find('.tfa-code-inputs input');
    let is_verifying = false;

    $inputs.on('input', function () {
        const val = $(this).val().replace(/\D/g, '');
        $(this).val(val.slice(0, 1));
        $(this).removeClass('error');
        $w.find('.tfa-code-error').text('');

        if ( val && $(this).data('idx') < 5 ) {
            $inputs.eq($(this).data('idx') + 1).focus();
        }

        // Check if all 6 digits entered
        const code = $inputs.map(function () { return $(this).val(); }).get().join('');
        if ( code.length === 6 && ! is_verifying ) {
            verify_code(code);
        }
    });

    $inputs.on('keydown', function (e) {
        const idx = $(this).data('idx');
        if ( e.key === 'Backspace' && ! $(this).val() && idx > 0 ) {
            $inputs.eq(idx - 1).focus().val('');
        }
        if ( e.key === 'ArrowLeft' && idx > 0 ) {
            e.preventDefault();
            $inputs.eq(idx - 1).focus();
        }
        if ( e.key === 'ArrowRight' && idx < 5 ) {
            e.preventDefault();
            $inputs.eq(idx + 1).focus();
        }
    });

    // Handle paste on any code input
    $inputs.on('paste', function (e) {
        e.preventDefault();
        const pasted = (e.originalEvent.clipboardData || window.clipboardData)
            .getData('text').replace(/\D/g, '').slice(0, 6);
        if ( ! pasted ) return;
        for ( let i = 0; i < 6; i++ ) {
            $inputs.eq(i).val(pasted[i] || '');
        }
        const last = Math.min(pasted.length, 6) - 1;
        $inputs.eq(last).focus();
        if ( pasted.length === 6 && ! is_verifying ) {
            verify_code(pasted);
        }
    });

    async function verify_code (code) {
        is_verifying = true;
        $inputs.attr('disabled', true);
        $w.find('.tfa-code-spinner').addClass('visible');
        $w.find('.tfa-code-error').text('');

        const result = await api('test', { code });

        $w.find('.tfa-code-spinner').removeClass('visible');

        if ( result.ok ) {
            go_to_screen(2);
        } else {
            $inputs.addClass('error').attr('disabled', false);
            $w.find('.tfa-code-error').text('Invalid code. Please try again.');
            // Clear and re-focus
            setTimeout(() => {
                $inputs.val('').removeClass('error');
                $inputs.first().focus();
            }, 1200);
        }
        is_verifying = false;
    }

    // Focus first input on load
    setTimeout(() => $inputs.first().focus(), 150);

    // ── Copy secret key ──────────────────────────────────────────────────
    $w.find('.tfa-copy-secret').on('click', function () {
        navigator.clipboard.writeText(secret);
        const $btn = $(this);
        $btn.html(SVG_CHECK);
        setTimeout(() => $btn.html(SVG_COPY), 1500);
    });

    // ── Recovery code actions ────────────────────────────────────────────
    $w.find('.tfa-copy-codes').on('click', function () {
        navigator.clipboard.writeText(data.codes.join('\n'));
        const $span = $(this).find('span');
        const orig = $span.text();
        $span.text('Copied!');
        $(this).addClass('copied');
        setTimeout(() => {
            $span.text(orig);
            $(this).removeClass('copied');
        }, 2000);
    });

    $w.find('.tfa-print-codes').on('click', function () {
        const grid_html = $w.find('.tfa-codes-grid').get(0).outerHTML;
        const print_frame = $w.find('.tfa-print-frame').get(0);
        const style = '<style>body{font-family:monospace;padding:20px} .tfa-codes-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px} .tfa-code-item{padding:8px;font-size:14px;display:flex;gap:8px} .tfa-code-item-idx{color:#999}</style>';
        print_frame.contentWindow.document.body.innerHTML = style + '<h2>Recovery Codes</h2>' + grid_html;
        print_frame.contentWindow.focus();
        print_frame.contentWindow.print();
    });

    // ── Confirmation checkboxes ──────────────────────────────────────────
    $w.find('.tfa-confirmations input[type="checkbox"]').on('change', function () {
        const all_checked = $w.find('.tfa-confirmations input[type="checkbox"]').toArray()
            .every(el => el.checked);
        $w.find('.tfa-enable-btn').prop('disabled', ! all_checked);
    });

    // ── Enable 2FA ───────────────────────────────────────────────────────
    $w.find('.tfa-enable-btn').on('click', async function () {
        $(this).prop('disabled', true).text('Enabling...');
        await api('enable');
        setup_succeeded = true;
        go_to_screen(3);
    });

    // ── Done button ──────────────────────────────────────────────────────
    $w.find('.tfa-done-btn').on('click', function () {
        resolve_promise(true);
        $w.close();
    });

    return { promise };
};

export default UIWindow2FASetup;
