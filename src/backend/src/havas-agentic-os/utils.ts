const MAX_TEXT_LENGTH = 240;

export const nowISO = (): string => new Date().toISOString();

export const createId = (prefix: string): string => {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}_${Date.now().toString(36)}_${random}`;
};

export const asText = (value: unknown, fallback = ''): string => {
    if ( typeof value !== 'string' ) return fallback;
    return value.trim().slice(0, MAX_TEXT_LENGTH);
};

export const asStringArray = (value: unknown): string[] => {
    if ( ! Array.isArray(value) ) return [];
    return value.map(item => asText(item)).filter(Boolean);
};

export const actorFrom = (value: unknown): string => asText(value, 'demo-admin') || 'demo-admin';
