/**
 * PuterTheme - Shared CSS custom properties for Puter web components.
 * CSS custom properties pierce Shadow DOM boundaries, making them
 * the natural theming mechanism for web components.
 */

export const themeCSS = `
    :host {
        /* Typography */
        --puter-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        --puter-font-size-sm: 12px;
        --puter-font-size-base: 14px;
        --puter-font-size-md: 15px;
        --puter-font-size-lg: 20px;

        /* Border Radius */
        --puter-border-radius-sm: 4px;
        --puter-border-radius: 8px;
        --puter-border-radius-lg: 12px;

        /* Colors - Light mode defaults */
        --puter-color-primary: #3b82f6;
        --puter-color-primary-hover: #2563eb;
        --puter-color-primary-gradient: linear-gradient(135deg, #34a5f8 0%, #088ef0 100%);
        --puter-color-primary-gradient-hover: linear-gradient(135deg, #088ef0 0%, #0670c0 100%);

        --puter-color-danger: #D32F2F;
        --puter-color-danger-gradient: linear-gradient(135deg, #f83434 0%, #f00808 100%);
        --puter-color-warning: #FFA000;
        --puter-color-info: #1976D2;
        --puter-color-success: #388E3C;

        --puter-color-bg: rgba(231, 238, 245, 0.95);
        --puter-color-bg-solid: #ffffff;
        --puter-color-bg-notification: rgba(255, 255, 255, 0.8);
        --puter-color-bg-menu: rgba(231, 238, 245, 0.98);

        --puter-color-text: #414650;
        --puter-color-text-secondary: #666666;
        --puter-color-text-light: #999999;
        --puter-color-text-on-primary: #ffffff;

        --puter-color-border: #e8e8e8;
        --puter-color-border-light: #e6e4e466;
        --puter-color-input-border: #cccccc;
        --puter-color-input-border-focus: #01a0fd;

        --puter-color-select: hsl(213, 74%, 56%);

        --puter-color-button-default-bg: linear-gradient(135deg, #f6f6f6 0%, #e1e1e1 100%);
        --puter-color-button-default-text: #666666;

        /* Shadows */
        --puter-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        --puter-shadow-menu: 0px 0px 15px rgba(0, 0, 0, 0.4);
        --puter-shadow-notification: 0px 0px 17px -9px #000;

        /* Backdrop */
        --puter-backdrop: rgba(0, 0, 0, 0.5);
        --puter-backdrop-blur: blur(3px);

        /* Misc */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
    }
`;

export default { themeCSS };
