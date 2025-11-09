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
import { UIColorPickerWidget, hslaToHex8 } from './UIColorPickerWidget.js';
import UIWindow from './UIWindow.js';

const encodeHTML = (value) => {
    if ( value === undefined || value === null ) return '';
    return html_encode(String(value));
};

/**
 * Creates a basic factory for rendering and initializing theme form fields.
 * This keeps the dialog extensible as we introduce new customizable controls.
 */
const createThemeFieldFactory = () => {
    let fieldCount = 0;
    const pendingInitializers = [];
    const fieldAPIs = new Map();
    const fieldLinkSubscribers = new Map();

    const registerInitializer = (callback) => {
        pendingInitializers.push(callback);
    };

    const registerFieldApi = (fieldId, api) => {
        fieldAPIs.set(fieldId, api);
    };

    const getFieldApi = (fieldId) => fieldAPIs.get(fieldId);

    const subscribeToFieldValue = (fieldId, callback) => {
        if (!fieldLinkSubscribers.has(fieldId)) {
            fieldLinkSubscribers.set(fieldId, new Set());
        }
        const set = fieldLinkSubscribers.get(fieldId);
        set.add(callback);
        return () => {
            set.delete(callback);
            if (set.size === 0) {
                fieldLinkSubscribers.delete(fieldId);
            }
        };
    };

    const notifyLinkedFields = (fieldId, payload) => {
        const listeners = fieldLinkSubscribers.get(fieldId);
        if (!listeners) return;
        listeners.forEach((listener) => {
            try {
                listener(payload);
            } catch (err) {
                console.error('Theme field subscriber error', err);
            }
        });
    };

    const createFieldWrapper = ({
        fieldId,
        label,
        description,
        labelFor,
        controlMarkup,
        extraClass = '',
    }) => {
        const safeFieldId = encodeHTML(fieldId);
        const safeExtraClass = extraClass ? ` ${encodeHTML(extraClass)}` : '';
        let html = `<div class="theme-field${safeExtraClass}" data-theme-field-id="${safeFieldId}">`;
        if ( label ) {
            if ( labelFor ) {
                html += `<label class="theme-field-label" for="${encodeHTML(labelFor)}">${encodeHTML(label)}</label>`;
            } else {
                html += `<div class="theme-field-label">${encodeHTML(label)}</div>`;
            }
        }
        if ( description ) {
            html += `<p class="theme-field-description">${encodeHTML(description)}</p>`;
        }
        html += `<div class="theme-field-control">${controlMarkup}</div>`;
        html += '</div>';
        return html;
    };

    const colorField = (options = {}) => {
        const fieldId = options.id ?? `theme-color-field-${++fieldCount}`;
        const normalizedDefault = typeof options.defaultValue === 'string'
            ? options.defaultValue
            : '#ffffffff';
        const defaultDisplayColor = (normalizedDefault ?? '#000000').toUpperCase();
        const safeDisplayColor = encodeHTML(defaultDisplayColor);
        const linkable = options.linkable ?? null;
        const toggleId = linkable ? `${fieldId}-link-toggle` : null;
        const linkToggleLabel = linkable?.toggleLabel ?? 'Customize separately';
        const linkHint = linkable?.hint ?? 'Matches the base color until customized.';
        const markup = createFieldWrapper({
            fieldId,
            label: options.label,
            description: options.description,
            controlMarkup: `
                <div class="theme-color-picker-control" data-color-field>
                    <button type="button"
                        class="theme-color-preview"
                        data-color-field-preview
                        aria-haspopup="dialog"
                        aria-expanded="false">
                        <span class="theme-color-preview-swatch" style="background: ${safeDisplayColor}"></span>
                        <span class="theme-color-preview-value">${safeDisplayColor}</span>
                        <span class="theme-color-preview-chevron">&#9662;</span>
                    </button>
                    <div class="theme-color-picker-popout" role="dialog" aria-hidden="true">
                        <div class="theme-color-picker-surface">
                            <div class="picker"></div>
                        </div>
                    </div>
                    ${linkable ? `
                        <div class="theme-field-link-controls">
                            <label class="theme-field-link-toggle" for="${encodeHTML(toggleId)}">
                                <input type="checkbox"
                                    id="${encodeHTML(toggleId)}"
                                    data-color-link-toggle
                                    aria-checked="false" />
                                <span>${encodeHTML(linkToggleLabel)}</span>
                            </label>
                            <p class="theme-field-link-hint">${encodeHTML(linkHint)}</p>
                        </div>
                    ` : ''}
                </div>`,
            extraClass: 'theme-field-color',
        });

        registerInitializer(($root) => {
            const $field = $root.find(`[data-theme-field-id="${fieldId}"]`);
            const $picker = $field.find('.picker');
            const $previewButton = $field.find('[data-color-field-preview]');
            const $swatch = $field.find('.theme-color-preview-swatch');
            const $value = $field.find('.theme-color-preview-value');
            const $popout = $field.find('.theme-color-picker-popout');
            const $windowRoot = $field.closest('.window');
            const $linkToggle = linkable ? $field.find('[data-color-link-toggle]') : null;
            const eventNamespace = fieldId.replace(/[^a-zA-Z0-9_-]/g, '-') || `theme-color-field-${fieldCount}`;

            let linkedState = linkable ? (linkable.defaultLinked !== false) : false;
            let customColorHex = null;
            let latestLinkedColor = defaultDisplayColor;
            let colorPickerWidget;
            let unsubscribeLinkedSource = null;

            // Move the popout to <body> so it is not clipped by window chrome.
            $popout.appendTo(document.body);

            const dispatchLinkToggle = () => {
                if ( !linkable ) return;
                options.onLinkToggle?.({
                    linked: linkedState,
                    fieldId,
                    sourceFieldId: linkable?.sourceFieldId ?? null,
                    hsla: colorPickerWidget?.getHSLA?.() ?? null,
                });
            };

            const updatePreview = (colorValue, background) => {
                if ( ! colorValue ) return;
                const normalized = colorValue.toUpperCase();
                $swatch.css('background', background ?? normalized);
                $value.text(normalized);
            };

            const emitColorPayload = (extra = {}) => {
                const payload = {
                    color: extra.color ?? (colorPickerWidget?.getHex8String?.() ?? defaultDisplayColor),
                    hsla: extra.hsla ?? colorPickerWidget?.getHSLA?.(),
                    widget: colorPickerWidget,
                    $field,
                    isLinked: linkedState,
                    ...extra,
                };
                options.onColorChange?.(payload);
                notifyLinkedFields(fieldId, payload);
            };

            const updateLinkedVisualState = () => {
                if ( !linkable ) return;
                $field.toggleClass('theme-field-linked', linkedState);
                $previewButton.prop('disabled', linkedState);
                $previewButton.attr('aria-disabled', linkedState ? 'true' : 'false');
                if ( $linkToggle?.length ) {
                    $linkToggle.prop('checked', !linkedState);
                    $linkToggle.attr('aria-checked', (!linkedState).toString());
                }
            };

            const repositionPopout = () => {
                const popoutNode = $popout.get(0);
                const previewNode = $previewButton.get(0);
                if ( !popoutNode || !previewNode ) return;

                const spacing = 12;
                const previewRect = previewNode.getBoundingClientRect();
                const popoutRect = popoutNode.getBoundingClientRect();
                const viewportWidth = window.innerWidth;
                const viewportHeight = window.innerHeight;

                let top = previewRect.bottom + spacing;
                let placementY = 'below';
                if ( top + popoutRect.height > viewportHeight - spacing ) {
                    top = previewRect.top - spacing - popoutRect.height;
                    placementY = 'above';
                    if ( top < spacing ) {
                        top = Math.max(spacing, viewportHeight - popoutRect.height - spacing);
                    }
                }

                let left = previewRect.left;
                if ( left + popoutRect.width > viewportWidth - spacing ) {
                    left = Math.max(spacing, viewportWidth - spacing - popoutRect.width);
                }
                left = Math.max(spacing, left);

                $popout
                    .css({ top: `${top}px`, left: `${left}px` })
                    .attr('data-placement-y', placementY);
            };

            const closePopout = () => {
                $field.removeClass('color-popout-open');
                $popout.attr('aria-hidden', 'true').removeClass('is-visible');
                $previewButton.attr('aria-expanded', 'false');
                $(document).off(`mousedown.${eventNamespace}`);
                $(window).off(`keydown.${eventNamespace}`);
                $(window).off(`resize.${eventNamespace}`);
                $(window).off(`scroll.${eventNamespace}`);
            };

            const openPopout = () => {
                if ( linkable && linkedState ) return;
                $field.addClass('color-popout-open');
                $popout.attr('aria-hidden', 'false').addClass('is-visible');
                $previewButton.attr('aria-expanded', 'true');
                repositionPopout();

                const handleDocumentClick = (event) => {
                    const popoutNode = $popout.get(0);
                    const previewNode = $previewButton.get(0);
                    if (
                        popoutNode === event.target ||
                        previewNode === event.target ||
                        $.contains(popoutNode, event.target) ||
                        $.contains(previewNode, event.target)
                    ) {
                        return;
                    }
                    closePopout();
                };

                const handleKeyDown = (event) => {
                    if ( event.key === 'Escape' ) {
                        event.stopPropagation();
                        closePopout();
                    }
                };

                $(document).on(`mousedown.${eventNamespace}`, handleDocumentClick);
                $(window).on(`keydown.${eventNamespace}`, handleKeyDown);
                $(window).on(`resize.${eventNamespace} scroll.${eventNamespace}`, repositionPopout);
            };

            $previewButton.on('click', (event) => {
                event.preventDefault();
                if ( linkable && linkedState ) {
                    return;
                }
                if ( $field.hasClass('color-popout-open') ) {
                    closePopout();
                } else {
                    openPopout();
                }
            });

            const handleLinkedSourceUpdate = ({ color, hsla }) => {
                latestLinkedColor = color ?? latestLinkedColor;
                if ( linkedState && colorPickerWidget ) {
                    colorPickerWidget.setColor(latestLinkedColor);
                }
            };

            if ( linkable?.sourceFieldId ) {
                const sourceApi = getFieldApi(linkable.sourceFieldId);
                const sourceInitialColor = sourceApi?.getHexColor?.();
                if ( sourceInitialColor ) {
                    latestLinkedColor = sourceInitialColor;
                }
                unsubscribeLinkedSource = subscribeToFieldValue(linkable.sourceFieldId, handleLinkedSourceUpdate);
            }

            const setLinkedState = (isLinked) => {
                if ( !linkable || linkedState === isLinked ) return;
                linkedState = isLinked;
                updateLinkedVisualState();
                if ( linkedState ) {
                    closePopout();
                    if ( latestLinkedColor ) {
                        colorPickerWidget?.setColor(latestLinkedColor);
                    }
                } else {
                    if ( !customColorHex ) {
                        customColorHex = colorPickerWidget?.getHex8String
                            ? colorPickerWidget.getHex8String()
                            : customColorHex;
                    }
                    emitColorPayload();
                }
                dispatchLinkToggle();
            };

            if ( $linkToggle?.length && linkable ) {
                updateLinkedVisualState();
                $linkToggle.on('change', () => {
                    const wantsCustom = $linkToggle.is(':checked');
                    setLinkedState(!wantsCustom);
                });
            }

            const handleColorChange = (color) => {
                const hexValue = color?.hex8String ?? colorPickerWidget?.getHex8String?.() ?? color?.hexString;
                const backgroundValue = color?.rgbaString ?? hexValue;
                updatePreview(hexValue, backgroundValue);
                if ( !linkedState ) {
                    customColorHex = hexValue;
                } else {
                    latestLinkedColor = hexValue;
                }
                emitColorPayload({
                    color: hexValue,
                    hsla: color?.hsla ?? colorPickerWidget?.getHSLA(),
                });
            };

            colorPickerWidget = UIColorPickerWidget($picker, {
                default: options.defaultValue,
                onColorChange: handleColorChange,
            });

            const initialHex = colorPickerWidget.getHex8String ? colorPickerWidget.getHex8String() : defaultDisplayColor;
            const initialBackground = colorPickerWidget.getColor ? colorPickerWidget.getColor().rgbaString : initialHex;
            latestLinkedColor = initialHex;
            updatePreview(initialHex, initialBackground);
            updateLinkedVisualState();
            dispatchLinkToggle();
            if ( linkable && linkedState && latestLinkedColor ) {
                colorPickerWidget.setColor(latestLinkedColor);
            }

            const cleanupPopout = () => {
                closePopout();
                unsubscribeLinkedSource?.();
                $popout.remove();
                if ( $windowRoot.length ) {
                    $windowRoot.off(`remove.${eventNamespace}`, cleanupPopout);
                }
            };
            if ( $windowRoot.length ) {
                $windowRoot.on(`remove.${eventNamespace}`, cleanupPopout);
            }

            const fieldApi = {
                setColor: (value) => {
                    colorPickerWidget.setColor(value);
                    const newValue = colorPickerWidget.getHex8String ? colorPickerWidget.getHex8String() : value;
                    const rgbaValue = colorPickerWidget.getColor ? colorPickerWidget.getColor().rgbaString : newValue;
                    updatePreview(newValue, rgbaValue);
                },
                getHSLA: () => colorPickerWidget.getHSLA(),
                getHexColor: () => colorPickerWidget.getHex8String?.() ?? colorPickerWidget.getHexString(),
                widget: colorPickerWidget,
                $field,
                openPicker: openPopout,
                closePicker: closePopout,
                setLinked: (value) => setLinkedState(value),
                isLinked: () => linkedState,
            };

            registerFieldApi(fieldId, fieldApi);
            options.onReady?.(fieldApi);
        });

        return markup;
    };

    const numericField = (options = {}) => {
        const fieldId = options.id ?? `theme-numeric-field-${++fieldCount}`;
        const inputId = `${fieldId}-input`;
        const classes = ['theme-field-numeric'];
        if ( options.extraFieldClass ) classes.push(options.extraFieldClass);
        const linkable = options.linkable ?? null;
        const toggleId = linkable ? `${fieldId}-link-toggle` : null;
        const inputAttributes = [
            `id="${encodeHTML(inputId)}"`,
            'type="number"',
            'inputmode="decimal"',
            'class="theme-field-number-input"',
        ];
        if ( options.min !== undefined ) inputAttributes.push(`min="${encodeHTML(options.min)}"`);
        if ( options.max !== undefined ) inputAttributes.push(`max="${encodeHTML(options.max)}"`);
        if ( options.step !== undefined ) inputAttributes.push(`step="${encodeHTML(options.step)}"`);
        if ( options.placeholder ) inputAttributes.push(`placeholder="${encodeHTML(options.placeholder)}"`);

        const markup = createFieldWrapper({
            fieldId,
            label: options.label,
            description: options.description,
            labelFor: inputId,
            controlMarkup: `
                <div class="theme-field-input ${options.suffix ? 'has-suffix' : ''}">
                    <input ${inputAttributes.join(' ')} />
                    ${options.suffix ? `<span class="theme-field-suffix">${encodeHTML(options.suffix)}</span>` : ''}
                </div>
                ${linkable ? `
                    <div class="theme-field-link-controls">
                        <label class="theme-field-link-toggle" for="${encodeHTML(toggleId)}">
                            <input type="checkbox"
                                id="${encodeHTML(toggleId)}"
                                data-field-link-toggle
                                aria-checked="false" />
                            <span>${encodeHTML(linkable.toggleLabel ?? 'Customize separately')}</span>
                        </label>
                        <p class="theme-field-link-hint">${encodeHTML(linkable.hint ?? 'Matches the base value until customized.')}</p>
                    </div>
                ` : ''}
            `,
            extraClass: classes.join(' '),
        });

        registerInitializer(($root) => {
            const $field = $root.find(`[data-theme-field-id="${fieldId}"]`);
            const $input = $field.find(`#${inputId}`);
            const $linkToggle = linkable ? $field.find('[data-field-link-toggle]') : null;
            if ( options.defaultValue !== undefined && options.defaultValue !== null ) {
                $input.val(options.defaultValue);
            }

            let linkedState = linkable ? (linkable.defaultLinked !== false) : false;
            let latestLinkedValue = options.defaultValue ?? null;
            let customValue = options.defaultValue ?? null;
            let unsubscribeLinkedSource = null;

            const setInputDisabled = (disabled) => {
                $input.prop('disabled', disabled);
                $input.attr('aria-disabled', disabled ? 'true' : 'false');
                $field.toggleClass('theme-field-linked', disabled);
            };

            const dispatchLinkToggle = () => {
                if ( !linkable ) return;
                const raw = $input.val();
                const value = raw === '' ? null : Number(raw);
                options.onLinkToggle?.({
                    linked: linkedState,
                    fieldId,
                    sourceFieldId: linkable?.sourceFieldId ?? null,
                    value,
                });
            };

            const emitChange = (event, optionsOverride = {}) => {
                const raw = event.target.value;
                const value = raw === '' ? null : Number(raw);
                if ( !optionsOverride.skipNotify ) {
                    if ( !linkedState ) {
                        customValue = value;
                    } else {
                        latestLinkedValue = value;
                    }
                    notifyLinkedFields(fieldId, { value });
                }
                options.onChange?.({ value, event, $input, $field });
            };

            const setLinkedState = (isLinked) => {
                if ( !linkable || linkedState === isLinked ) return;
                linkedState = isLinked;
                setInputDisabled(linkedState);
                if ( linkedState ) {
                    if ( latestLinkedValue !== undefined ) {
                        $input.val(latestLinkedValue ?? '');
                        emitChange({ target: $input.get(0) }, { skipNotify: true });
                    }
                } else {
                    if ( customValue !== undefined ) {
                        $input.val(customValue ?? '');
                        emitChange({ target: $input.get(0) }, { skipNotify: true });
                    }
                }
                if ( $linkToggle?.length ) {
                    $linkToggle.prop('checked', !linkedState);
                    $linkToggle.attr('aria-checked', (!linkedState).toString());
                }
                dispatchLinkToggle();
            };

            const handleLinkedSourceUpdate = ({ value }) => {
                latestLinkedValue = value ?? latestLinkedValue;
                if ( linkedState ) {
                    $input.val(latestLinkedValue ?? '');
                    emitChange({ target: $input.get(0) }, { skipNotify: true });
                }
            };

            if ( linkable?.sourceFieldId ) {
                const sourceApi = getFieldApi(linkable.sourceFieldId);
                if ( sourceApi?.getValue ) {
                    latestLinkedValue = sourceApi.getValue();
                    if ( linkedState ) {
                        $input.val(latestLinkedValue ?? '');
                    }
                }
                unsubscribeLinkedSource = subscribeToFieldValue(linkable.sourceFieldId, handleLinkedSourceUpdate);
            }

            if ( $linkToggle?.length ) {
                setInputDisabled(linkedState);
                $linkToggle.prop('checked', !linkedState);
                $linkToggle.on('change', () => {
                    const wantsCustom = $linkToggle.is(':checked');
                    setLinkedState(!wantsCustom);
                });
            }

            $input.on('input change', emitChange);

            const fieldApi = {
                setValue: (value) => {
                    if ( value === null || value === undefined ) {
                        $input.val('');
                        return;
                    }
                    $input.val(value);
                },
                getValue: () => {
                    const raw = $input.val();
                    return raw === '' ? null : Number(raw);
                },
                setLinked: (value) => setLinkedState(value),
                isLinked: () => linkedState,
                $field,
                $input,
            };

            registerFieldApi(fieldId, fieldApi);

            options.onReady?.(fieldApi);

            if ( linkable && linkedState ) {
                setLinkedState(true);
            }

            $field.on('remove', () => {
                unsubscribeLinkedSource?.();
            });

            if ( !linkable || !linkedState ) {
                dispatchLinkToggle();
            }
        });

        return markup;
    };

    const degreesField = (options = {}) => numericField({
        ...options,
        suffix: options.suffix ?? '°',
        extraFieldClass: `${options.extraFieldClass ?? ''} theme-field-degrees`.trim(),
    });

    const runInitializers = ($root) => {
        pendingInitializers.forEach((init) => init($root));
    };

    return {
        colorField,
        numericField,
        degreesField,
        runInitializers,
        getFieldApi,
        subscribeToFieldValue,
        notifyLinkedFields,
    };
};

const UIWindowThemeDialog = async function UIWindowThemeDialog (options) {
    options = options ?? {};
    const services = globalThis.services;
    const svc_theme = services.get('theme');

    // Get current theme values and convert to hex8 for the color picker
    const currentHue = svc_theme.get('hue');
    const currentSat = svc_theme.get('sat');
    const currentLig = svc_theme.get('lig');
    const currentAlpha = svc_theme.get('alpha');
    const initialColor = hslaToHex8(currentHue, currentSat, currentLig, currentAlpha);

    const fieldFactory = createThemeFieldFactory();
    const baseColorFieldId = 'window-base-color';
    let baseColorFieldApi = null;
    let titlebarColorFieldApi = null;
    let bodyColorFieldApi = null;
    const filterFieldAPIs = {};

    const applyWindowColorFromHSLA = (hsla) => {
        const state = {
            hue: hsla.h,
            sat: hsla.s,
            lig: hsla.l,
            alpha: hsla.a,
            light_text: hsla.l < 60,
        };
        svc_theme.apply(state);
    };

    const onAccentColorChange = (region) => (payload) => {
        if ( !payload?.hsla ) return;
        if ( payload.isLinked ) {
            svc_theme.clearAccentColor(region);
            return;
        }
        svc_theme.setAccentColor(region, payload.hsla);
    };

    const onAccentLinkToggle = (region) => ({ linked, hsla }) => {
        if ( linked ) {
            svc_theme.clearAccentColor(region);
        } else if ( hsla ) {
            svc_theme.setAccentColor(region, hsla);
        }
    };

    const fallbackFilterDefaults = {
        blur: 3,
        saturate: 100,
        brightness: 100,
        contrast: 100,
        hueRotate: 0,
        invert: 0,
        grayscale: 0,
        sepia: 0,
    };
    const currentFilterValues = typeof svc_theme.getFilters === 'function'
        ? svc_theme.getFilters()
        : fallbackFilterDefaults;
    const filterDefaults = {
        ...fallbackFilterDefaults,
        ...currentFilterValues,
    };
    const handleBackdropFilterChange = (key) => ({ value }) => {
        svc_theme.setBackdropFilters({
            [key]: value,
        });
    };

    const baseColorFieldMarkup = fieldFactory.colorField({
        id: baseColorFieldId,
        label: 'Base color',
        description: 'Adjust how Puter windows are tinted across the desktop.',
        defaultValue: initialColor,
        onColorChange: ({ hsla }) => {
            applyWindowColorFromHSLA(hsla);
        },
        onReady: (api) => {
            baseColorFieldApi = api;
        },
    });

    const titlebarColorFieldMarkup = fieldFactory.colorField({
        id: 'window-titlebar-color',
        label: 'Titlebar color',
        description: 'Applies this tint to the window titlebar and window controls.',
        defaultValue: initialColor,
        linkable: {
            sourceFieldId: baseColorFieldId,
            toggleLabel: 'Customize titlebar color',
            hint: 'Leave unchecked to inherit the base color.',
        },
        onColorChange: onAccentColorChange('titlebar'),
        onLinkToggle: onAccentLinkToggle('titlebar'),
        onReady: (api) => {
            titlebarColorFieldApi = api;
        },
    });

    const bodyColorFieldMarkup = fieldFactory.colorField({
        id: 'window-body-color',
        label: 'Body color',
        description: 'Controls the fill color behind window content.',
        defaultValue: initialColor,
        linkable: {
            sourceFieldId: baseColorFieldId,
            toggleLabel: 'Customize body color',
            hint: 'Leave unchecked to inherit the base color.',
        },
        onColorChange: onAccentColorChange('body'),
        onLinkToggle: onAccentLinkToggle('body'),
        onReady: (api) => {
            bodyColorFieldApi = api;
        },
    });

    const backdropFilterFieldDefinitions = [
        { key: 'blur', label: 'Blur', suffix: 'px', min: 0, max: 50, step: 0.5 },
        { key: 'saturate', label: 'Saturation', suffix: '%', min: 0, max: 400, step: 1 },
        { key: 'brightness', label: 'Brightness', suffix: '%', min: 0, max: 300, step: 1 },
        { key: 'contrast', label: 'Contrast', suffix: '%', min: 0, max: 300, step: 1 },
        { key: 'hueRotate', label: 'Hue rotate', suffix: '°', min: 0, max: 360, step: 1 },
        { key: 'invert', label: 'Invert', suffix: '%', min: 0, max: 100, step: 1 },
        { key: 'grayscale', label: 'Grayscale', suffix: '%', min: 0, max: 100, step: 1 },
        { key: 'sepia', label: 'Sepia', suffix: '%', min: 0, max: 100, step: 1 },
    ];

    const backdropFilterFieldsMarkup = backdropFilterFieldDefinitions.map((descriptor) => fieldFactory.numericField({
        id: `window-filter-${descriptor.key}`,
        label: descriptor.label,
        suffix: descriptor.suffix,
        min: descriptor.min,
        max: descriptor.max,
        step: descriptor.step,
        defaultValue: filterDefaults[descriptor.key],
        onChange: handleBackdropFilterChange(descriptor.key),
        onReady: (api) => {
            filterFieldAPIs[descriptor.key] = api;
        },
    })).join('');

    const tabDefinitions = [
        {
            id: 'themes',
            label: 'Themes',
            content: () => '<div class="theme-dialog-placeholder">Saved themes will appear here. Use this space to store and load custom looks for your desktop.</div>',
        },
        {
            id: 'window-color',
            label: 'Window Color',
            content: () => `<div class="theme-panel-section" data-section="window-color">
                    <div class="theme-panel-section-header">
                        <div class="theme-panel-section-copy">
                            <h3 class="theme-panel-title">Window Color</h3>
                            <p class="theme-panel-description">Control the base color, opacity, and future window accents.</p>
                        </div>
                        <button type="button" class="button button-secondary reset-colors-btn">${i18n('reset_colors')}</button>
                    </div>
                    ${baseColorFieldMarkup}
                    <div class="theme-panel-subsection">
                        <p class="theme-panel-subsection-title">Surface accents</p>
                        ${titlebarColorFieldMarkup}
                        ${bodyColorFieldMarkup}
                    </div>
                    <div class="theme-panel-subsection">
                        <p class="theme-panel-subsection-title">Backdrop filters</p>
                        ${backdropFilterFieldsMarkup}
                    </div>
                </div>`,
        },
    ];

    const navButtonsMarkup = tabDefinitions.map((tab) => {
        const safeTabId = encodeHTML(tab.id);
        const safeLabel = encodeHTML(tab.label);
        return `
            <button type="button"
                class="theme-dialog-nav-button"
                data-tab="${safeTabId}"
                role="tab"
                aria-selected="false"
                aria-controls="theme-panel-${safeTabId}"
                id="theme-tab-${safeTabId}">
                ${safeLabel}
            </button>`;
    }).join('');

    const panelsMarkup = tabDefinitions.map((tab) => {
        const safeTabId = encodeHTML(tab.id);
        return `
            <section class="theme-dialog-panel stack"
                id="theme-panel-${safeTabId}"
                data-tab="${safeTabId}"
                role="tabpanel"
                aria-hidden="true"
                aria-labelledby="theme-tab-${safeTabId}">
                ${tab.content()}
            </section>`;
    }).join('');

    let h = '';
    h += `<style>
        .ui-theme-dialog .theme-dialog-layout {
            display: flex;
            gap: 16px;
            min-width: 320px;
        }
        .ui-theme-dialog .theme-dialog-nav {
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 140px;
        }
        .ui-theme-dialog .theme-dialog-nav-button {
            background: transparent;
            border: none;
            border-radius: 10px;
            padding: 10px 12px;
            text-align: left;
            font-weight: 600;
            color: var(--text-color, #fff);
            cursor: pointer;
            transition: background-color 0.15s ease;
        }
        .ui-theme-dialog .theme-dialog-nav-button.active {
            background-color: rgba(255, 255, 255, 0.14);
        }
        .ui-theme-dialog .theme-dialog-nav-button:focus-visible {
            outline: 2px solid rgba(255, 255, 255, 0.6);
            outline-offset: 2px;
        }
        .ui-theme-dialog .theme-dialog-panels {
            flex: 1;
            min-width: 0;
            min-height: 220px;
            overflow: visible;
        }
        .ui-theme-dialog .theme-dialog-panel {
            display: none;
        }
        .ui-theme-dialog .theme-dialog-panel.active {
            display: flex;
        }
        .ui-theme-dialog .theme-dialog-panel.stack {
            flex-direction: column;
            gap: 12px;
        }
        .ui-theme-dialog .theme-dialog-placeholder {
            padding: 14px;
            border-radius: 12px;
            border: 1px dashed rgba(255, 255, 255, 0.3);
            font-size: 0.9em;
            line-height: 1.4;
            opacity: 0.9;
        }
        .ui-theme-dialog .theme-panel-section {
            display: flex;
            flex-direction: column;
            gap: 14px;
            padding: 18px;
            border-radius: 18px;
            background-color: rgba(0, 0, 0, 0.15);
            width: 100%;
            box-sizing: border-box;
        }
        .ui-theme-dialog .theme-panel-section-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
        }
        .ui-theme-dialog .theme-panel-section-copy {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .ui-theme-dialog .theme-panel-title {
            margin: 0;
            font-size: 1em;
            font-weight: 600;
        }
        .ui-theme-dialog .theme-panel-description {
            margin: 0;
            font-size: 0.85em;
            opacity: 0.75;
        }
        .ui-theme-dialog .theme-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 12px 0;
        }
        .ui-theme-dialog .theme-field-label {
            font-size: 0.95em;
            font-weight: 600;
        }
        .ui-theme-dialog .theme-field-description {
            margin: 0;
            font-size: 0.82em;
            opacity: 0.75;
        }
        .ui-theme-dialog .theme-field-control {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .ui-theme-dialog .theme-field-link-controls {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin-top: 6px;
        }
        .ui-theme-dialog .theme-field-link-toggle {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 0.85em;
            cursor: pointer;
        }
        .ui-theme-dialog .theme-field-link-toggle input {
            width: 16px;
            height: 16px;
            cursor: pointer;
        }
        .ui-theme-dialog .theme-field-link-hint {
            margin: 0;
            font-size: 0.78em;
            opacity: 0.7;
        }
        .ui-theme-dialog .theme-field.theme-field-linked .theme-color-preview {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .ui-theme-dialog .theme-field.theme-field-linked .theme-color-preview:focus-visible {
            outline: none;
        }
        .ui-theme-dialog .theme-panel-subsection {
            margin-top: 4px;
            padding-top: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.15);
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .ui-theme-dialog .theme-panel-subsection-title {
            margin: 0;
            font-size: 0.9em;
            font-weight: 600;
            opacity: 0.8;
        }
        .ui-theme-dialog .theme-field-color .theme-color-picker-control {
            position: relative;
            width: 100%;
        }
        .ui-theme-dialog .theme-color-preview {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background-color: rgba(255, 255, 255, 0.05);
            color: inherit;
            font: inherit;
            cursor: pointer;
        }
        .ui-theme-dialog .theme-color-preview:focus-visible {
            outline: 2px solid rgba(255, 255, 255, 0.6);
            outline-offset: 2px;
        }
        .ui-theme-dialog .theme-color-preview-swatch {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            border: 1px solid rgba(0, 0, 0, 0.3);
            flex-shrink: 0;
        }
        .ui-theme-dialog .theme-color-preview-value {
            font-weight: 600;
            letter-spacing: 0.5px;
        }
        .ui-theme-dialog .theme-color-preview-chevron {
            margin-left: auto;
            opacity: 0.7;
        }
        .ui-theme-dialog .theme-color-picker-popout,
        .theme-color-picker-popout {
            position: fixed;
            top: 0;
            left: 0;
            background-color: rgba(15, 15, 15, 0.94);
            border-radius: 16px;
            padding: 12px;
            box-shadow: 0 18px 45px rgba(0, 0, 0, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.12);
            z-index: 1000000000;
            opacity: 0;
            pointer-events: none;
            transform: scale(0.98);
            transform-origin: top left;
            transition: opacity 0.15s ease, transform 0.15s ease;
            max-width: calc(100vw - 24px);
            max-height: calc(100vh - 24px);
            visibility: hidden;
            display: none;
        }
        .theme-color-picker-popout.is-visible {
            opacity: 1;
            pointer-events: auto;
            transform: scale(1);
            visibility: visible;
            display: block;
        }
        .theme-color-picker-popout.is-visible[data-placement-y="above"] {
            transform-origin: bottom left;
        }
        .theme-color-picker-surface {
            width: max-content;
        }
        .ui-theme-dialog .theme-field-input {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: 10px;
            background-color: rgba(255, 255, 255, 0.08);
        }
        .ui-theme-dialog .theme-field-input input {
            width: 100%;
            background: transparent;
            border: none;
            color: inherit;
            font: inherit;
            outline: none;
        }
        .ui-theme-dialog .theme-field-input.has-suffix input {
            padding-right: 0;
        }
        .ui-theme-dialog .theme-field-suffix {
            font-weight: 600;
            opacity: 0.7;
        }
    </style>`;
    h += '<div class="ui-theme-dialog">';
    h += '  <div class="theme-dialog-layout">';
    h += '      <nav class="theme-dialog-nav" role="tablist" aria-label="Theme options">';
    h += navButtonsMarkup;
    h += '      </nav>';
    h += '      <div class="theme-dialog-panels">';
    h += panelsMarkup;
    h += '      </div>';
    h += '  </div>';
    h += '</div>';

    const el_window = await UIWindow({
        title: i18n('ui_colors'),
        icon: null,
        uid: null,
        is_dir: false,
        body_content: h,
        is_resizable: false,
        is_droppable: false,
        has_head: true,
        stay_on_top: true,
        selectable_body: false,
        draggable_body: false,
        allow_context_menu: false,
        show_in_taskbar: false,
        window_class: 'window-alert',
        dominant: true,
        width: 580,
        window_css: {
            height: 'initial',
        },
        body_css: {
            width: 'initial',
            padding: '20px',
            'background-color': `hsla(
                var(--primary-hue),
                var(--primary-saturation),
                var(--primary-lightness),
                var(--primary-alpha))`,
            'backdrop-filter': 'var(--window-backdrop-filter)',
        },
        ...options.window_options,
        onAppend: function (window) {
            // Setup tab navigation and initialize registered theme fields
            const $dialog = $(window);
            const setActiveTab = (tabName) => {
                const $buttons = $dialog.find('.theme-dialog-nav-button');
                const $panels = $dialog.find('.theme-dialog-panel');
                $buttons.attr('aria-selected', 'false').removeClass('active');
                $panels.attr('aria-hidden', 'true').removeClass('active');
                $buttons.filter(`[data-tab="${tabName}"]`).attr('aria-selected', 'true').addClass('active');
                $panels.filter(`[data-tab="${tabName}"]`).attr('aria-hidden', 'false').addClass('active');
            };

            $dialog.find('.theme-dialog-nav-button').on('click', function () {
                setActiveTab($(this).data('tab'));
            });

            setActiveTab('window-color');
            fieldFactory.runInitializers($dialog);
        },
    });

    // Reset button handler
    $(el_window).find('.reset-colors-btn').on('click', function () {
        svc_theme.reset();
        const resetHue = svc_theme.get('hue');
        const resetSat = svc_theme.get('sat');
        const resetLig = svc_theme.get('lig');
        const resetAlpha = svc_theme.get('alpha');
        const resetColor = hslaToHex8(resetHue, resetSat, resetLig, resetAlpha);
        if ( baseColorFieldApi ) {
            baseColorFieldApi.setColor(resetColor);
        }
        if ( titlebarColorFieldApi ) {
            titlebarColorFieldApi.setLinked(true);
        }
        if ( bodyColorFieldApi ) {
            bodyColorFieldApi.setLinked(true);
        }
        const resetFilters = typeof svc_theme.getFilters === 'function'
            ? svc_theme.getFilters()
            : fallbackFilterDefaults;
        backdropFilterFieldDefinitions.forEach(({ key }) => {
            filterFieldAPIs[key]?.setValue(resetFilters[key]);
        });
    });

    return {};
};

export default UIWindowThemeDialog;
