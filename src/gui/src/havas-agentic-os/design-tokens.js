export const havasAgenticOSTokens = Object.freeze({
    color: {
        brandRed: '#E60000',
        brandRedGlow: 'rgba(230, 0, 0, 0.4)',
        brandRedSoft: 'rgba(230, 0, 0, 0.12)',
        backgroundBase: '#0A0A0A',
        backgroundWarm: '#12100E',
        backgroundDeep: '#0D0808',
        surface: 'rgba(255, 255, 255, 0.06)',
        surfaceHover: 'rgba(255, 255, 255, 0.12)',
        text: '#F5F5F5',
        textDim: 'rgba(255, 255, 255, 0.45)',
        dockBackground: 'rgba(14, 14, 14, 0.85)',
        dockBorder: 'rgba(255, 255, 255, 0.06)',
        chatBackground: 'rgba(14, 14, 14, 0.92)',
        chatBorder: 'rgba(230, 0, 0, 0.2)',
        statusGreen: '#22c55e',
        statusAmber: '#f59e0b',
        statusBlue: '#38bdf8',
    },
    font: {
        family: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        sizeXs: '9px',
        sizeSm: '11px',
        sizeMd: '13px',
        sizeLg: '16px',
        lineHeightTight: '1.2',
        lineHeightBody: '1.45',
    },
    space: {
        xxs: '4px',
        xs: '6px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        desktopInset: '16px',
        dockHeight: '72px',
        chatWidth: '360px',
    },
    radius: {
        control: '8px',
        icon: '10px',
        panel: '16px',
        round: '999px',
    },
    shadow: {
        redGlow: '0 0 16px rgba(230, 0, 0, 0.4)',
        dock: '0 18px 40px rgba(0, 0, 0, 0.35)',
        chat: '0 24px 60px rgba(0, 0, 0, 0.45)',
    },
    motion: {
        fast: '120ms ease',
        base: '180ms ease',
        slow: '260ms ease',
    },
    zIndex: {
        desktop: 850,
        panel: 2,
        dock: 5,
        chat: 6,
    },
});

export const havasAgenticOSCSSVariables = Object.freeze({
    '--havas-red': havasAgenticOSTokens.color.brandRed,
    '--havas-red-glow': havasAgenticOSTokens.color.brandRedGlow,
    '--havas-red-soft': havasAgenticOSTokens.color.brandRedSoft,
    '--havas-surface': havasAgenticOSTokens.color.surface,
    '--havas-surface-hover': havasAgenticOSTokens.color.surfaceHover,
    '--havas-text': havasAgenticOSTokens.color.text,
    '--havas-text-dim': havasAgenticOSTokens.color.textDim,
    '--dock-bg': havasAgenticOSTokens.color.dockBackground,
    '--dock-border': havasAgenticOSTokens.color.dockBorder,
    '--chat-bg': havasAgenticOSTokens.color.chatBackground,
    '--chat-border': havasAgenticOSTokens.color.chatBorder,
});

export const createHavasAgenticOSCSSVariables = (selector = '.cxos-desktop') => {
    const lines = Object.entries(havasAgenticOSCSSVariables)
        .map(([name, value]) => `    ${name}: ${value};`);
    return `${selector} {\n${lines.join('\n')}\n}`;
};
