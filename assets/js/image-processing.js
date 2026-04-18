import { refs, state } from './state.js?v=20260418-3';
import {
    clamp,
    clampChannel,
    formatSignedValue,
    hslToRgb,
    rgbToHsl
} from './utils.js?v=20260418-3';

export const DEFAULT_DITHER_ALGORITHM = 'atkinson';

const ERROR_DIFFUSION_MAP = {
    'floyd-steinberg': [
        [1, 0, 7 / 16],
        [-1, 1, 3 / 16],
        [0, 1, 5 / 16],
        [1, 1, 1 / 16]
    ],
    'false-floyd-steinberg': [
        [1, 0, 3 / 8],
        [0, 1, 3 / 8],
        [1, 1, 1 / 4]
    ],
    'minimized-average-error': [
        [1, 0, 7 / 48],
        [2, 0, 5 / 48],
        [-2, 1, 3 / 48],
        [-1, 1, 5 / 48],
        [0, 1, 7 / 48],
        [1, 1, 5 / 48],
        [2, 1, 3 / 48],
        [-2, 2, 1 / 48],
        [-1, 2, 3 / 48],
        [0, 2, 5 / 48],
        [1, 2, 3 / 48],
        [2, 2, 1 / 48]
    ],
    stucki: [
        [1, 0, 8 / 42],
        [2, 0, 4 / 42],
        [-2, 1, 2 / 42],
        [-1, 1, 4 / 42],
        [0, 1, 8 / 42],
        [1, 1, 4 / 42],
        [2, 1, 2 / 42],
        [-2, 2, 1 / 42],
        [-1, 2, 2 / 42],
        [0, 2, 4 / 42],
        [1, 2, 2 / 42],
        [2, 2, 1 / 42]
    ],
    atkinson: [
        [1, 0, 1 / 8],
        [2, 0, 1 / 8],
        [-1, 1, 1 / 8],
        [0, 1, 1 / 8],
        [1, 1, 1 / 8],
        [0, 2, 1 / 8]
    ],
    burkes: [
        [1, 0, 8 / 32],
        [2, 0, 4 / 32],
        [-2, 1, 2 / 32],
        [-1, 1, 4 / 32],
        [0, 1, 8 / 32],
        [1, 1, 4 / 32],
        [2, 1, 2 / 32]
    ],
    sierra: [
        [1, 0, 5 / 32],
        [2, 0, 3 / 32],
        [-2, 1, 2 / 32],
        [-1, 1, 4 / 32],
        [0, 1, 5 / 32],
        [1, 1, 4 / 32],
        [2, 1, 2 / 32],
        [-1, 2, 2 / 32],
        [0, 2, 3 / 32],
        [1, 2, 2 / 32]
    ],
    'two-row': [
        [1, 0, 4 / 16],
        [2, 0, 3 / 16],
        [-2, 1, 1 / 16],
        [-1, 1, 2 / 16],
        [0, 1, 3 / 16],
        [1, 1, 2 / 16],
        [2, 1, 1 / 16]
    ],
    'sierra-lite': [
        [1, 0, 2 / 4],
        [-1, 1, 1 / 4],
        [0, 1, 1 / 4]
    ]
};

/** 后续会多次/大块 getImageData 读回像素时，避免 Canvas2D 性能提示并选用更适合读回的实现 */
const CANVAS_2D_READBACK = { willReadFrequently: true };

export function updateAdjustmentPreview() {
    const brightness = Math.pow(2, state.adjustmentState.exposure / 100).toFixed(3);
    const contrast = Math.max(0, 1 + state.adjustmentState.contrast / 100).toFixed(3);
    const saturation = Math.max(0, 1 + state.adjustmentState.saturation / 100).toFixed(3);
    const filters = [];

    if (state.adjustmentState.exposure !== 0) {
        filters.push(`brightness(${brightness})`);
    }

    if (state.adjustmentState.contrast !== 0) {
        filters.push(`contrast(${contrast})`);
    }

    if (state.adjustmentState.hue !== 0) {
        filters.push(`hue-rotate(${state.adjustmentState.hue}deg)`);
    }

    if (state.adjustmentState.saturation !== 0) {
        filters.push(`saturate(${saturation})`);
    }

    const filterValue = filters.length ? filters.join(' ') : 'none';
    refs.image.style.filter = filterValue;
    refs.editorStage.querySelectorAll('.cropper-container img').forEach((img) => {
        img.style.filter = filterValue;
    });
}

export function updateAdjustmentValueLabels() {
    refs.exposureValue.textContent = formatSignedValue(state.adjustmentState.exposure);
    refs.contrastValue.textContent = formatSignedValue(state.adjustmentState.contrast);
    refs.saturationValue.textContent = formatSignedValue(state.adjustmentState.saturation);
}

export function syncAdjustmentInputs() {
    refs.exposureInput.value = String(state.adjustmentState.exposure);
    refs.contrastInput.value = String(state.adjustmentState.contrast);
    refs.saturationInput.value = String(state.adjustmentState.saturation);
    updateAdjustmentValueLabels();
    updateAdjustmentPreview();
}

export function resetAdjustments() {
    state.adjustmentState = {
        exposure: 0,
        contrast: 0,
        hue: 0,
        saturation: 0
    };
    syncAdjustmentInputs();
}

export function applyImageAdjustmentsToCanvas(sourceCanvas) {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = sourceCanvas.width;
    outputCanvas.height = sourceCanvas.height;

    const outputContext = outputCanvas.getContext('2d', CANVAS_2D_READBACK);
    outputContext.drawImage(sourceCanvas, 0, 0);

    const imageData = outputContext.getImageData(0, 0, outputCanvas.width, outputCanvas.height);
    const pixels = imageData.data;
    const exposureFactor = Math.pow(2, state.adjustmentState.exposure / 100);
    const contrastFactor = Math.max(0, 1 + state.adjustmentState.contrast / 100);
    const saturationFactor = Math.max(0, 1 + state.adjustmentState.saturation / 100);
    const hueShift = state.adjustmentState.hue;
    const shouldAdjustHueSat = hueShift !== 0 || saturationFactor !== 1;

    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] === 0) {
            continue;
        }

        let red = clamp(pixels[index] * exposureFactor, 0, 255);
        let green = clamp(pixels[index + 1] * exposureFactor, 0, 255);
        let blue = clamp(pixels[index + 2] * exposureFactor, 0, 255);

        red = clamp((red - 127.5) * contrastFactor + 127.5, 0, 255);
        green = clamp((green - 127.5) * contrastFactor + 127.5, 0, 255);
        blue = clamp((blue - 127.5) * contrastFactor + 127.5, 0, 255);

        if (shouldAdjustHueSat) {
            const hsl = rgbToHsl(red, green, blue);
            const shiftedHue = (hsl.hue + hueShift + 360) % 360;
            const adjustedSaturation = clamp(hsl.saturation * saturationFactor, 0, 1);
            [red, green, blue] = hslToRgb(shiftedHue, adjustedSaturation, hsl.lightness);
        }

        pixels[index] = Math.round(red);
        pixels[index + 1] = Math.round(green);
        pixels[index + 2] = Math.round(blue);
    }

    outputContext.putImageData(imageData, 0, 0);
    return outputCanvas;
}

export function fillCanvasBackground(sourceCanvas, color) {
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = sourceCanvas.width;
    outputCanvas.height = sourceCanvas.height;

    const outputContext = outputCanvas.getContext('2d');
    outputContext.fillStyle = color || '#ffffff';
    outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    outputContext.drawImage(sourceCanvas, 0, 0);

    return outputCanvas;
}

export function canvasToBMP(canvas) {
    const ctx = canvas.getContext('2d', CANVAS_2D_READBACK);
    const width = canvas.width;
    const height = canvas.height;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const bytesPerPixel = 3;
    const rowSize = width * bytesPerPixel;
    const paddedRowSize = (rowSize + 3) & ~3;
    const paddingSize = paddedRowSize - rowSize;
    const pixelArraySize = paddedRowSize * height;
    const pixelDataOffset = 54;
    const fileSize = pixelDataOffset + pixelArraySize;
    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    view.setUint8(0, 0x42);
    view.setUint8(1, 0x4D);
    view.setUint32(2, fileSize, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint32(10, pixelDataOffset, true);

    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    view.setUint32(30, 0, true);
    view.setUint32(34, pixelArraySize, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    view.setUint32(46, 0, true);
    view.setUint32(50, 0, true);

    let offset = pixelDataOffset;
    for (let y = height - 1; y >= 0; y--) {
        const rowStart = y * width * 4;
        for (let x = 0; x < width; x++) {
            const pixelOffset = rowStart + x * 4;
            bytes[offset++] = pixels[pixelOffset + 2];
            bytes[offset++] = pixels[pixelOffset + 1];
            bytes[offset++] = pixels[pixelOffset];
        }
        for (let p = 0; p < paddingSize; p++) {
            bytes[offset++] = 0;
        }
    }

    return buffer;
}

export function getIndexedBmpBitDepth(paletteLength) {
    const safePaletteLength = Math.max(1, Math.min(256, Number(paletteLength) || 0));

    if (safePaletteLength <= 2) {
        return 1;
    }
    // Windows 标准 BMP 仅支持 1/4/8/16/24/32 bpp，不支持 2bpp；3–16 色统一用 4bpp。
    if (safePaletteLength <= 16) {
        return 4;
    }
    return 8;
}

function getIndexedBmpRowSize(width, bitDepth) {
    return ((width * bitDepth + 31) >> 5) << 2;
}

function packIndexedRow(indices, rowStart, width, bitDepth, output, outputOffset) {
    if (bitDepth === 8) {
        for (let x = 0; x < width; x++) {
            output[outputOffset + x] = indices[rowStart + x];
        }
        return;
    }

    if (bitDepth === 4) {
        for (let x = 0; x < width; x += 2) {
            const left = indices[rowStart + x] & 0x0F;
            const right = x + 1 < width ? (indices[rowStart + x + 1] & 0x0F) : 0;
            output[outputOffset++] = (left << 4) | right;
        }
        return;
    }

    for (let x = 0; x < width; x += 8) {
        let packed = 0;
        for (let bit = 0; bit < 8; bit++) {
            const pixelX = x + bit;
            const pixelIndex = pixelX < width ? (indices[rowStart + pixelX] & 0x01) : 0;
            packed |= pixelIndex << (7 - bit);
        }
        output[outputOffset++] = packed;
    }
}

export function exportIndexedBMP(indexedPixels, width, height, palette) {
    const paletteSize = Math.max(1, Math.min(256, palette.length));
    const bitDepth = getIndexedBmpBitDepth(paletteSize);
    const rowSize = getIndexedBmpRowSize(width, bitDepth);
    const pixelArraySize = rowSize * height;
    const paletteBytes = paletteSize * 4;
    const pixelDataOffset = 14 + 40 + paletteBytes;
    const fileSize = pixelDataOffset + pixelArraySize;
    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);

    view.setUint8(0, 0x42);
    view.setUint8(1, 0x4D);
    view.setUint32(2, fileSize, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint32(10, pixelDataOffset, true);

    view.setUint32(14, 40, true);
    view.setInt32(18, width, true);
    view.setInt32(22, height, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, bitDepth, true);
    view.setUint32(30, 0, true);
    view.setUint32(34, pixelArraySize, true);
    view.setInt32(38, 2835, true);
    view.setInt32(42, 2835, true);
    view.setUint32(46, paletteSize, true);
    view.setUint32(50, paletteSize, true);

    let paletteOffset = 54;
    for (let index = 0; index < paletteSize; index++) {
        const color = palette[index];
        bytes[paletteOffset++] = color[2];
        bytes[paletteOffset++] = color[1];
        bytes[paletteOffset++] = color[0];
        bytes[paletteOffset++] = 255;
    }

    let offset = pixelDataOffset;
    for (let y = height - 1; y >= 0; y--) {
        const rowStart = y * width;
        packIndexedRow(indexedPixels, rowStart, width, bitDepth, bytes, offset);
        offset += rowSize;
    }

    return buffer;
}

export function indexedToBMP(width, height, indices, palette) {
    return exportIndexedBMP(indices, width, height, palette);
}

const DEFAULT_PALETTE_NAME = '4-color.act';
const DEFAULT_PALETTE = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 255, 0],
    [255, 0, 0]
];

const paletteStore = {
    [DEFAULT_PALETTE_NAME]: DEFAULT_PALETTE
};

function normalizePalette(palette) {
    if (!Array.isArray(palette) || !palette.length) {
        return DEFAULT_PALETTE;
    }
    return palette
        .filter((color) => Array.isArray(color) && color.length >= 3)
        .map((color) => [clampChannel(color[0]), clampChannel(color[1]), clampChannel(color[2])]);
}

function parseActPalette(buffer) {
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 3) {
        return DEFAULT_PALETTE;
    }

    let colorCount = Math.floor(Math.min(bytes.length, 768) / 3);
    if (bytes.length >= 770) {
        const declaredCount = (bytes[768] << 8) | bytes[769];
        if (declaredCount > 0 && declaredCount <= 256) {
            colorCount = Math.min(colorCount, declaredCount);
        }
    }

    const palette = [];
    for (let index = 0; index < colorCount; index++) {
        const offset = index * 3;
        palette.push([bytes[offset], bytes[offset + 1], bytes[offset + 2]]);
    }

    return normalizePalette(palette);
}

export function registerPalette(name, palette) {
    if (!name) {
        return;
    }
    paletteStore[name] = normalizePalette(palette);
}

export async function loadPaletteFromACT(name, url) {
    if (!name || !url) {
        return;
    }
    if (paletteStore[name]) {
        return;
    }

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`加载色板失败: ${name}`);
    }
    const buffer = await response.arrayBuffer();
    registerPalette(name, parseActPalette(buffer));
}

export async function preloadPalettesFromManifest(entries, basePath = './act/') {
    const tasks = (entries || []).map(async (entry) => {
        const filename = typeof entry === 'string' ? entry : entry?.file;
        if (!filename) {
            return;
        }
        try {
            await loadPaletteFromACT(filename, `${basePath}${filename}`);
        } catch {
            // ignore failed palette file, keep app usable
        }
    });
    await Promise.all(tasks);
}

export function getSelectedPalette(paletteName) {
    return paletteStore[paletteName] || paletteStore[DEFAULT_PALETTE_NAME] || DEFAULT_PALETTE;
}

export function getDitherAlgorithm(algorithmName) {
    return ERROR_DIFFUSION_MAP[algorithmName] || ERROR_DIFFUSION_MAP[DEFAULT_DITHER_ALGORITHM];
}

export function findNearestPaletteColor(red, green, blue, palette) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < palette.length; index++) {
        const color = palette[index];
        const dr = red - color[0];
        const dg = green - color[1];
        const db = blue - color[2];
        const distance = dr * dr + dg * dg + db * db;

        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
        }
    }

    return {
        index: bestIndex,
        color: palette[bestIndex]
    };
}

export function addError(buffer, width, height, x, y, errorRed, errorGreen, errorBlue, factor) {
    if (x < 0 || x >= width || y < 0 || y >= height) {
        return;
    }

    const offset = (y * width + x) * 4;
    buffer[offset] += errorRed * factor;
    buffer[offset + 1] += errorGreen * factor;
    buffer[offset + 2] += errorBlue * factor;
}

export function quantizeCanvasToIndexed(
    canvas,
    paletteName,
    algorithmName = DEFAULT_DITHER_ALGORITHM,
    serpentine = false
) {
    const ctx = canvas.getContext('2d', CANVAS_2D_READBACK);
    const width = canvas.width;
    const height = canvas.height;
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const working = new Float32Array(pixels.length);
    const palette = getSelectedPalette(paletteName);
    const diffusionKernel = getDitherAlgorithm(algorithmName);
    const indices = new Uint8Array(width * height);

    for (let index = 0; index < pixels.length; index++) {
        working[index] = pixels[index];
    }

    for (let y = 0; y < height; y++) {
        const reverseScan = serpentine && (y % 2 === 1);
        const xStart = reverseScan ? width - 1 : 0;
        const xEnd = reverseScan ? -1 : width;
        const xStep = reverseScan ? -1 : 1;

        for (let x = xStart; x !== xEnd; x += xStep) {
            const offset = (y * width + x) * 4;
            const red = clampChannel(working[offset]);
            const green = clampChannel(working[offset + 1]);
            const blue = clampChannel(working[offset + 2]);

            const nearest = findNearestPaletteColor(red, green, blue, palette);
            const nearestColor = nearest.color;

            pixels[offset] = nearestColor[0];
            pixels[offset + 1] = nearestColor[1];
            pixels[offset + 2] = nearestColor[2];
            pixels[offset + 3] = 255;
            indices[y * width + x] = nearest.index;

            const errorRed = red - nearestColor[0];
            const errorGreen = green - nearestColor[1];
            const errorBlue = blue - nearestColor[2];
            diffusionKernel.forEach(([dx, dy, factor]) => {
                const adjustedDx = reverseScan ? -dx : dx;
                addError(working, width, height, x + adjustedDx, y + dy, errorRed, errorGreen, errorBlue, factor);
            });
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return {
        width,
        height,
        palette,
        indices,
        imageData
    };
}
