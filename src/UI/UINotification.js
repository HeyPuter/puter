/**
 * Copyright (C) 2024 Puter Technologies Inc.
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

window.active_notifs = []

function UINotification(options){
    window.global_element_id++;

    options.text = options.text ?? '';
    window.active_notifs.push(window.global_element_id);

    let h = '';
    h += `<div id="ui-notification__${window.global_element_id}" data-el-id="${window.global_element_id}" class="notification antialiased animate__animated animate__fadeInRight animate__slow">`;
        h += `<img class="notification-close" src="${html_encode(window.icons['close.svg'])}">`;
        h += `<div class="notification-icon">`;
            h += `<img src="${html_encode(options.icon)}">`;
        h += `</div>`;
        h += `<div class="notification-content">`;
            h += `<div class="notification-title">${html_encode(options.title)}</div>`;
            h += `<div class="notification-text">${html_encode(options.text)}</div>`;
        h += `</div>`;
    h += `</div>`;

    $('.notification-container').prepend(h);


    const el_notification = document.getElementById(`ui-notification__${window.global_element_id}`);

    $(el_notification).show(0, function(e){
        // options.onAppend()
        if(options.onAppend && typeof options.onAppend === 'function'){
            options.onAppend(el_notification);
        }
    })

    $(el_notification).on('click', function(e){
        if(options.click && typeof options.click === 'function'){
            options.click(options.value);
        }
    })

    // Show Notification
    $(el_notification).delay(100).show(0);
    return el_notification;
}

$(document).on('click', '.notification', function(e){
    if($(e.target).hasClass('notification')){
        // TODO: options isn't available here
        // if(options.click && typeof options.click === 'function'){
        //     options.click(e);
        // }
        window.close_notification(e.target);
    }else{
        window.close_notification($(e.target).closest('.notification'));
    }
});

$(document).on('click', '.notification-close', function(e){
    window.close_notification($(e.target).closest('.notification'));
});


window.close_notification = function(el_notification){
    $(el_notification).addClass('animate__fadeOutRight');


    // remove notification
    setTimeout(function(){
        $(el_notification).remove();
    }, 300);
}

export default UINotification;