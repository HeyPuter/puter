/**
 * Copyright (C) 2024 present Puter Technologies Inc.
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
 *  Feature developed by Light :D
 * 
 * GitHub Issue = Desktop Widgets #345
 */

import UIWindowThemeDialog from '../UIWindowThemeDialog.js';
import UIWindowDesktopBGSettings from '../UIWindowDesktopBGSettings.js';
import UIComponentWindow from '../UIComponentWindow.js';

export default {
    id: 'widgets',
    title_i18n_key: 'Widgets',
    icon: 'widgets-outline.png',
    html: () => {
        return `
            <h1>Widgets</h1>
            <div class="settings-card">
                <div style="display:flex; align-items:center;">
                    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
                    <span class="material-symbols-outlined" style="font-size:32px; margin-right:15px;">schedule</span>
                    <div style="flex-grow:1;">
                        <strong>International Time</strong>
                    </div>
                    <button class="button open-clock" style="margin-left: 175px;">Open</button>
                </div>
            </div>
            <div class="settings-card">
                <div style="display:flex; align-items:center;">
                    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
                    <span class="material-symbols-outlined" style="font-size:32px; margin-right:15px;">calculate</span>
                    <div style="flex-grow:1;">
                        <strong>Calculator</strong>
                    </div>
                    <button class="button open-calculator" style="margin-left: 235px;">Open</button>
                </div>
            </div>
            <div class="settings-card">
                <div style="display:flex; align-items:center;">
                    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined" rel="stylesheet">
                    <span class="material-symbols-outlined" style="font-size:32px; margin-right:15px;">timer</span>
                    <div style="flex-grow:1;">
                        <strong>Stopwatch</strong>
                    </div>
                    <button class="button open-stopwatch" style="margin-left: 230px;">Open</button>
                </div>
            </div>`;
    },
    init: ($el_window) => {
        // Draggable widget creation function
        function createDraggableWidget(options) {
            const widget = document.createElement('div');
            widget.style.position = 'absolute';
            widget.style.top = options.top || '100px';
            widget.style.left = options.left || '100px';
            widget.style.backgroundColor = 'rgba(255,255,255,0.9)';
            widget.style.padding = '15px';
            widget.style.borderRadius = '8px';
            widget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
            widget.style.zIndex = '9999';
            widget.style.width = options.width || '200px';
            widget.style.textAlign = 'center';
            widget.style.cursor = 'move';
            widget.style.userSelect = 'none';
            widget.style.backdropFilter = 'blur(5px)';
            widget.style.border = '1px solid rgba(0,0,0,0.1)';
            
            widget.innerHTML = options.content;
            document.body.appendChild(widget);
            
            // Drag-and-drop functionality
            let isDragging = false;
            let offsetX, offsetY;
            
            widget.onmousedown = function(e) {
                if(!e.target.classList.contains('no-drag')) {
                    isDragging = true;
                    offsetX = e.clientX - widget.getBoundingClientRect().left;
                    offsetY = e.clientY - widget.getBoundingClientRect().top;
                    widget.style.cursor = 'grabbing';
                }
            };
            
            document.onmousemove = function(e) {
                if(!isDragging) return;
                
                widget.style.left = (e.clientX - offsetX) + 'px';
                widget.style.top = (e.clientY - offsetY) + 'px';
            };
            
            document.onmouseup = function() {
                isDragging = false;
                widget.style.cursor = 'move';
            };
            
            // Salva posizione
            widget.addEventListener('mouseup', function() {
                if(options.storageKey) {
                    localStorage.setItem(options.storageKey, JSON.stringify({
                        left: widget.style.left,
                        top: widget.style.top
                    }));
                }
            });
            
            // Restore saved position
            if(options.storageKey) {
                const savedPos = localStorage.getItem(options.storageKey);
                if(savedPos) {
                    const pos = JSON.parse(savedPos);
                    widget.style.left = pos.left;
                    widget.style.top = pos.top;
                }
            }
            
            return widget;
        }

        // International Time
        $el_window.find('.open-clock').on('click', function() {
            const widget = createDraggableWidget({
                storageKey: 'swissClockPosition',
                content: `
                    <div style="margin-bottom:10px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:12px;">🇨International Time</span>
                        <button class="no-drag" style="background:none;border:none;cursor:pointer;font-size:14px;color:#666;">×</button>
                    </div>
                    <div id="swiss-time" style="font-size:24px;font-weight:bold;margin:5px 0;"></div>
                    <div id="swiss-date" style="font-size:12px;color:#555;"></div>
                `
            });
            
            // Clock update function
            function updateClock() {
                const options = { 
                    timeZone: 'Europe/Zurich',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                };
                const dateOptions = {
                    timeZone: 'Europe/Zurich',
                    weekday: 'long',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                };
                
                const now = new Date();
                const timeStr = now.toLocaleTimeString('it-CH', options);
                const dateStr = now.toLocaleDateString('it-CH', dateOptions);
                
                widget.querySelector('#swiss-time').textContent = timeStr;
                widget.querySelector('#swiss-date').textContent = dateStr;
            }
            
            updateClock(); // Update immediately and set interval
            const clockInterval = setInterval(updateClock, 1000);
            
            // Close button
            widget.querySelector('button').onclick = function() {
                clearInterval(clockInterval);
                document.body.removeChild(widget);
            };
        });

        // Calculator
        $el_window.find('.open-calculator').on('click', function() {
            const widget = createDraggableWidget({
                storageKey: 'calculatorPosition',
                width: '250px',
                content: `
                    <div style="margin-bottom:10px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:12px;">🧮 Calculator</span>
                        <button class="no-drag" style="background:none;border:none;cursor:pointer;font-size:14px;color:#666;">×</button>
                    </div>
                    <input type="text" id="calc-display" style="width:100%;padding:8px;margin-bottom:10px;font-size:18px;text-align:right;" readonly>
                    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px;">
                        <button class="calc-btn no-drag" data-op="sqrt">√</button>
                        <button class="calc-btn no-drag" data-op="^">x^</button>
                        <button class="calc-btn no-drag" data-op="clear">C</button>
                        <button class="calc-btn no-drag" data-op="back">←</button>
                        
                        <button class="calc-btn no-drag" data-num="7">7</button>
                        <button class="calc-btn no-drag" data-num="8">8</button>
                        <button class="calc-btn no-drag" data-num="9">9</button>
                        <button class="calc-btn no-drag" data-op="/">/</button>
                        
                        <button class="calc-btn no-drag" data-num="4">4</button>
                        <button class="calc-btn no-drag" data-num="5">5</button>
                        <button class="calc-btn no-drag" data-num="6">6</button>
                        <button class="calc-btn no-drag" data-op="*">×</button>
                        
                        <button class="calc-btn no-drag" data-num="1">1</button>
                        <button class="calc-btn no-drag" data-num="2">2</button>
                        <button class="calc-btn no-drag" data-num="3">3</button>
                        <button class="calc-btn no-drag" data-op="-">-</button>
                        
                        <button class="calc-btn no-drag" data-num="0">0</button>
                        <button class="calc-btn no-drag" data-op=".">.</button>
                        <button class="calc-btn no-drag" data-op="=">=</button>
                        <button class="calc-btn no-drag" data-op="+">+</button>
                    </div>
                `
            });

            const display = widget.querySelector('#calc-display');
            let currentInput = '0';
            let previousInput = '';
            let operation = null;
            let resetInput = false;

            function updateDisplay() {
                display.value = currentInput;
            }

            function calculate() {
                let result;
                const prev = parseFloat(previousInput);
                const current = parseFloat(currentInput);

                if (isNaN(prev) || isNaN(current)) return;

                switch (operation) {
                    case '+':
                        result = prev + current;
                        break;
                    case '-':
                        result = prev - current;
                        break;
                    case '*':
                        result = prev * current;
                        break;
                    case '/':
                        result = prev / current;
                        break;
                    case '^':
                        result = Math.pow(prev, current);
                        break;
                    default:
                        return;
                }

                currentInput = result.toString();
                operation = null;
                previousInput = '';
                resetInput = true;
            }

            // Button click management
            widget.querySelectorAll('.calc-btn').forEach(button => {
                button.addEventListener('click', () => {
                    if (button.dataset.num) {
                        if (currentInput === '0' || resetInput) {
                            currentInput = button.dataset.num;
                            resetInput = false;
                        } else {
                            currentInput += button.dataset.num;
                        }
                    } else if (button.dataset.op) {
                        const op = button.dataset.op;
                        
                        if (op === 'sqrt') {
                            currentInput = Math.sqrt(parseFloat(currentInput)).toString();
                            resetInput = true;
                        } else if (op === 'clear') {
                            currentInput = '0';
                            previousInput = '';
                            operation = null;
                        } else if (op === 'back') {
                            currentInput = currentInput.length === 1 ? '0' : currentInput.slice(0, -1);
                        } else if (op === '.') {
                            if (!currentInput.includes('.')) {
                                currentInput += '.';
                            }
                        } else if (op === '=') {
                            if (operation && previousInput) {
                                calculate();
                            }
                        } else {
                            if (operation && previousInput && !resetInput) {
                                calculate();
                            }
                            previousInput = currentInput;
                            operation = op;
                            resetInput = true;
                        }
                    }
                    updateDisplay();
                });
            });

            // Close button
            widget.querySelector('button').onclick = function() {
                document.body.removeChild(widget);
            };
        });

        // Stopwatch
        $el_window.find('.open-stopwatch').on('click', function() {
            const widget = createDraggableWidget({
                storageKey: 'stopwatchPosition',
                width: '220px',
                content: `
                    <div style="margin-bottom:10px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:12px;">⏱️ Stopwatch</span>
                        <button class="no-drag" style="background:none;border:none;cursor:pointer;font-size:14px;color:#666;">×</button>
                    </div>
                    <div id="stopwatch-display" style="font-size:24px;text-align:center;margin:10px 0;">00:00:00.000</div>
                    <div style="display:flex;justify-content:center;gap:10px;">
                        <button class="no-drag" id="start-stopwatch" style="padding:5px 10px;">Start</button>
                        <button class="no-drag" id="reset-stopwatch" style="padding:5px 10px;">Reset</button>
                    </div>
                    <div id="laps" style="margin-top:10px;max-height:150px;overflow-y:auto;"></div>
                `
            });

            let startTime;
            let elapsedTime = 0;
            let timerInterval;
            let isRunning = false;

            function formatTime(ms) {
                const date = new Date(ms);
                const hours = date.getUTCHours().toString().padStart(2, '0');
                const minutes = date.getUTCMinutes().toString().padStart(2, '0');
                const seconds = date.getUTCSeconds().toString().padStart(2, '0');
                const milliseconds = date.getUTCMilliseconds().toString().padStart(3, '0');
                return `${hours}:${minutes}:${seconds}.${milliseconds}`;
            }

            function updateStopwatch() {
                const currentTime = Date.now();
                elapsedTime = currentTime - startTime;
                widget.querySelector('#stopwatch-display').textContent = formatTime(elapsedTime);
            }

            // Start/Stop button
            widget.querySelector('#start-stopwatch').addEventListener('click', function() {
                if (isRunning) {
                    clearInterval(timerInterval);
                    this.textContent = 'Start';
                    isRunning = false;
                } else {
                    startTime = Date.now() - elapsedTime;
                    timerInterval = setInterval(updateStopwatch, 10);
                    this.textContent = 'Stop';
                    isRunning = true;
                }
            });

            // Reset button
            widget.querySelector('#reset-stopwatch').addEventListener('click', function() {
                clearInterval(timerInterval);
                elapsedTime = 0;
                widget.querySelector('#stopwatch-display').textContent = formatTime(elapsedTime);
                widget.querySelector('#start-stopwatch').textContent = 'Start';
                isRunning = false;
                widget.querySelector('#laps').innerHTML = '';
            });

            // Close button
            widget.querySelector('button').onclick = function() {
                clearInterval(timerInterval);
                document.body.removeChild(widget);
            };
        });
    }
};