import { Service } from "../definitions.js";

export class ThemeService extends Service {
    async _init () {
        this.state = {
            sat: 100,
            hue: 200,
            lig: 70,
            alpha: 1,
        };
        this.ss = new CSSStyleSheet();
        document.adoptedStyleSheets.push(this.ss);
    }

    apply (values) {
        this.state = {
            ...this.state,
            ...values,
        };
        this.reload_();
    }

    get (key) { return this.state[key]; }

    reload_ () {
        // debugger;
        const s = this.state;
        this.ss.replace(`
            .taskbar, .window-head, .window-sidebar {
                background-color: hsla(${s.hue}, ${s.sat}%, ${s.lig}%, ${s.alpha});
            }
        `)
    }
}
