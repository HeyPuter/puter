/*
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
// 1.0.3
/*
The MIT License (MIT)

Copyright (c) 2015 Jan Martin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(function ($) {

    $.fn.dragster = function (options) {
        var settings = $.extend({
            enter: $.noop,
            leave: $.noop,
            over: $.noop,
            drop: $.noop
        }, options);

        return this.each(function () {
            var first = false,
                second = false,
                $this = $(this);

            $this.on({
                dragenter: function (event) {
                    if (first) {
                        second = true;
                        return;
                    } else {
                        first = true;
                        $this.trigger('dragster:enter', event);
                    }
                    event.preventDefault();
                },
                dragleave: function (event) {
                    if (second) {
                        second = false;
                    } else if (first) {
                        first = false;
                    }
                    if (!first && !second) {
                        $this.trigger('dragster:leave', event);
                    }
                    event.preventDefault();
                },
                dragover: function (event) {
                    $this.trigger('dragster:over', event);
                    event.preventDefault();
                },
                drop: function (event) {
                    if (second) {
                        second = false;
                    } else if (first) {
                        first = false;
                    }
                    if (!first && !second) {
                        $this.trigger('dragster:drop', event);
                    }
                    event.preventDefault();
                },
                'dragster:enter': settings.enter,
                'dragster:leave': settings.leave,
                'dragster:over': settings.over,
                'dragster:drop': settings.drop
            });
        });
    };

}(jQuery));
