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

export default function UIAIChat() {
    let h = '';

    // AI side panel
    h += `<div class="btn-show-ai"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-sparkles-icon lucide-sparkles"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg></div>`;

    h += `<div class="ai-panel">`;
        h += `<div class="ai-panel-header">`;
            h += `<div class="btn-hide-ai"><div class="generic-close-window-button"> &times; </div></div>`;
        h += `</div>`;
        h += `<div class="ai-chat-messages"></div>`;
        h += `<textarea class="ai-chat-input"></textarea>`;

        h += `<button class="btn-send-ai">Send</button>`;
    h += `</div>`;

    // append to desktop
    $('body').append(h);
}

$(document).on('click', '.btn-show-ai', function () {
    $('.ai-panel').addClass('ai-panel-open');
    $('.btn-show-ai').hide();
    $('.btn-hide-ai').show();
    // focus on the chat input
    $('.ai-chat-input').focus();
});

$(document).on('click', '.btn-hide-ai', function () {
    $('.ai-panel').removeClass('ai-panel-open');
    $('.btn-show-ai').show();
    $('.btn-hide-ai').hide();
});

$(document).on('click', '.btn-send-ai', function () {
    let chatInput = $('.ai-chat-input');
    let chatInputValue = chatInput.val();
    // append to the chat history
    $('.ai-chat-messages').append(`<div class="ai-chat-message"><div class="ai-chat-message-user">${html_encode(chatInputValue)}</div></div>`);
    $('.ai-chat-messages').addClass('active');
    // clear the chat input
    chatInput.val('');
    // send the message to the AI
    puter.ai.chat(chatInputValue, {model: 'claude-sonnet-4'}).then(function (response) {
        $('.ai-chat-messages').append(`<div class="ai-chat-message"><div class="ai-chat-message-ai">${html_encode(response.message.content[0].text)}</div></div>`);
    });
    // focus on the chat input
    chatInput.focus();
});