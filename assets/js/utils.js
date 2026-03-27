export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

export function formatSignedValue(value, suffix = '') {
    const numeric = Number(value) || 0;
    return `${numeric > 0 ? '+' : ''}${numeric}${suffix}`;
}

export function normalizeHexColor(value) {
    if (!value) {
        return null;
    }

    let normalized = value.trim().replace(/^#/, '');
    if (normalized.length === 3) {
        normalized = normalized.split('').map((char) => char + char).join('');
    }

    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
        return null;
    }

    return `#${normalized.toUpperCase()}`;
}

export function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    const delta = max - min;
    let hue = 0;
    let saturation = 0;

    if (delta !== 0) {
        saturation = delta / (1 - Math.abs(2 * lightness - 1));

        switch (max) {
            case r:
                hue = ((g - b) / delta) % 6;
                break;
            case g:
                hue = (b - r) / delta + 2;
                break;
            default:
                hue = (r - g) / delta + 4;
                break;
        }

        hue *= 60;
        if (hue < 0) {
            hue += 360;
        }
    }

    return { hue, saturation, lightness };
}

export function hueToRgb(p, q, t) {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
}

export function hslToRgb(hue, saturation, lightness) {
    const h = hue / 360;

    if (saturation === 0) {
        const grayscale = Math.round(lightness * 255);
        return [grayscale, grayscale, grayscale];
    }

    const q = lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;

    return [
        Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
        Math.round(hueToRgb(p, q, h) * 255),
        Math.round(hueToRgb(p, q, h - 1 / 3) * 255)
    ];
}

export function clampChannel(value) {
    return Math.max(0, Math.min(255, value));
}

