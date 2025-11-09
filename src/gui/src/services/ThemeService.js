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

import UIAlert from "../UI/UIAlert.js";
import { Service } from "../definitions.js";

const PUTER_THEME_DATA_FILENAME = '~/.__puter_gui.json';

const SAVE_COOLDOWN_TIME = 1000;

const default_values = {
    sat: 41.18,
    hue: 210,
    lig: 93.33,
    alpha: 0.8,
    light_text: false,
    accents: {
        titlebar: null,
        body: null,
    },
};

const cloneDefaultState = () => ({
    ...default_values,
    accents: {
        ...default_values.accents,
    },
});

export class ThemeService extends Service {
    #broadcastService;

    async _init () {
        this.#broadcastService = globalThis.services.get('broadcast');

        this.state = cloneDefaultState();
        this.root = document.querySelector(':root');
        // this.ss = new CSSStyleSheet();
        // document.adoptedStyleSheets.push(this.ss);

        this.save_cooldown_ = undefined;

        // Load theme data using .then() for non-blocking operation
        puter.fs.read(PUTER_THEME_DATA_FILENAME).then(async (data) => {
            try {
                if ( typeof data === 'object' ) {
                    data = await data.text();
                }
                
                if ( data ) {
                    try {
                        data = JSON.parse(data.toString());
                        if ( data && data.colors ) {
                            const { accents: loadedAccents, ...colorValues } = data.colors;
                            this.state = {
                                ...this.state,
                                ...colorValues,
                                accents: {
                                    ...(this.state.accents ?? cloneDefaultState().accents),
                                    ...loadedAccents,
                                },
                            };
                            this.reload_();
                        }
                    } catch (e) {
                        console.error(e);
                        UIAlert({
                            title: 'Error loading theme data',
                            message: `Could not parse "${PUTER_THEME_DATA_FILENAME}": ` +
                                e.message,
                        });
                    }
                }
            } catch (e) {
                console.error('Error processing theme data:', e);
            }
        }).catch((e) => {
            if ( e.code !== 'subject_does_not_exist' ) {
                // TODO: once we have an event log,
                //       log this error to the event log
                console.error(e);

                // We don't show an alert because it's likely
                // other things also aren't working.
            }
        });
    }

    reset () {
        this.state = cloneDefaultState();
        this.reload_();
        puter.fs.delete(PUTER_THEME_DATA_FILENAME);
    }

    apply (values) {
        const nextAccents = values?.accents
            ? {
                ...(this.state.accents ?? cloneDefaultState().accents),
                ...values.accents,
            }
            : this.state.accents;
        this.state = {
            ...this.state,
            ...values,
            accents: nextAccents,
        };
        this.reload_();
        this.save_();
    }

    get (key) { return this.state[key]; }

    setAccentColor (region, hsla) {
        if ( !this.#isAccentRegion(region) || !hsla ) return;
        const normalized = this.#normalizeAccentColor(hsla);
        this.state = {
            ...this.state,
            accents: {
                ...(this.state.accents ?? cloneDefaultState().accents),
                [region]: normalized,
            },
        };
        this.reload_();
        this.save_();
    }

    clearAccentColor (region) {
        if ( !this.#isAccentRegion(region) ) return;
        if ( !this.state.accents?.[region] ) return;
        this.state = {
            ...this.state,
            accents: {
                ...(this.state.accents ?? cloneDefaultState().accents),
                [region]: null,
            },
        };
        this.reload_();
        this.save_();
    }

    reload_() {
        // debugger;
        const s = this.state;
        // this.ss.replace(`
        //     .taskbar, .window-head, .window-sidebar {
        //         background-color: hsla(${s.hue}, ${s.sat}%, ${s.lig}%, ${s.alpha});
        //     }
        // `)
        // this.root.style.setProperty('--puter-window-background', `hsla(${s.hue}, ${s.sat}%, ${s.lig}%, ${s.alpha})`);
        this.root.style.setProperty('--primary-hue', s.hue);
        this.root.style.setProperty('--primary-saturation', s.sat + '%');
        this.root.style.setProperty('--primary-lightness', s.lig + '%');
        this.root.style.setProperty('--primary-alpha', s.alpha);
        this.root.style.setProperty('--primary-color', s.light_text ? 'white' : '#373e44');
        this.root.style.setProperty('--primary-color-icon', s.light_text ? 'invert(1)' : 'invert(0)');
        this.root.style.setProperty('--primary-color-sidebar-item', s.light_text ? '#5a5d61aa' : '#fefeff');

        const accents = this.state.accents ?? cloneDefaultState().accents;
        const baseColor = {
            hue: s.hue,
            sat: s.sat,
            lig: s.lig,
            alpha: s.alpha,
            light_text: s.light_text,
        };
        const titlebarColor = accents.titlebar ?? baseColor;
        this.#applyWindowHeadColor(titlebarColor);

        if ( accents.body ) {
            this.#applyWindowBodyColor(accents.body);
        } else {
            this.#clearWindowBodyColor();
        }

        // TODO: Should we debounce this to reduce traffic?
        this.#broadcastService.sendBroadcast('themeChanged', {
            palette: {
                primaryHue: s.hue,
                primarySaturation: s.sat + '%',
                primaryLightness: s.lig + '%',
                primaryAlpha: s.alpha,
                primaryColor: s.light_text ? 'white' : '#373e44',
            },
        }, { sendToNewAppInstances: true });
    }   

    save_ () {
        if ( this.save_cooldown_ ) {
            clearTimeout(this.save_cooldown_);
        }
        this.save_cooldown_ = setTimeout(() => {
            this.commit_save_();
        }, SAVE_COOLDOWN_TIME);
    }
    commit_save_ () {
        puter.fs.write(PUTER_THEME_DATA_FILENAME, JSON.stringify(
            { colors: this.state },
            undefined,
            5,
        ));
    }

    #isAccentRegion (region) {
        return ['titlebar', 'body'].includes(region);
    }

    #normalizeAccentColor (hsla) {
        return {
            hue: hsla.h,
            sat: hsla.s,
            lig: hsla.l,
            alpha: hsla.a,
            light_text: hsla.l < 60,
        };
    }

    #applyWindowHeadColor (color) {
        this.root.style.setProperty('--window-head-hue', color.hue);
        this.root.style.setProperty('--window-head-saturation', color.sat + '%');
        this.root.style.setProperty('--window-head-lightness', color.lig + '%');
        this.root.style.setProperty('--window-head-alpha', color.alpha);
        this.root.style.setProperty('--window-head-color', color.light_text ? 'white' : '#373e44');
    }

    #applyWindowBodyColor (color) {
        const hsla = this.#hslaString(color);
        this.root.style.setProperty('--window-body-background', hsla);
        this.root.style.setProperty('--window-body-foreground', color.light_text ? '#fefeff' : '#1b1f22');
    }

    #clearWindowBodyColor () {
        this.root.style.removeProperty('--window-body-background');
        this.root.style.removeProperty('--window-body-foreground');
    }

    #hslaString (color) {
        return `hsla(${color.hue}, ${color.sat}%, ${color.lig}%, ${color.alpha})`;
    }
}
