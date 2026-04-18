import { DEFAULT_DITHER_ALGORITHM, syncAdjustmentInputs, resetAdjustments, updateAdjustmentPreview, updateAdjustmentValueLabels } from './image-processing.js?v=20260418-3';
import { preloadPalettesFromManifest } from './image-processing.js?v=20260418-3';
import {
    appendFloatingPreviewToBody,
    constants,
    refs,
    state
} from './state.js?v=20260418-3';
import {
    applyZoomPercent,
    applyFixedCropBox,
    clearAll,
    exportBMP,
    getClipboardImageFile,
    loadImage,
    pickBackgroundColor,
    resetEditor,
    schedulePreviewRender,
    setBackgroundColor,
    setFloatingPreviewPosition,
    syncZoomControls,
    stopPreviewDrag,
    syncPresetSelection,
    tryAutoApplyResolution,
    updateCustomSizeVisibility,
    updateOverlayVisibility,
    updatePreviewCanvasPresentation,
    updateDitherUIState,
    updateInfo,
    updateOverlayMask
} from './editor.js?v=20260418-3';
import {
    applyPresetSelection,
    initializePresetManager,
    openPresetManager,
    selectCustomPreset
} from './preset-manager.js?v=20260418-3';
import { normalizeHexColor } from './utils.js?v=20260418-3';
import { APP_VERSION } from './version.js?v=20260418-3';

const HISTORY_LIMIT = 80;

const appVersionEl = document.getElementById('appVersion');
if (appVersionEl) {
    appVersionEl.textContent = APP_VERSION;
}

const DEFAULT_PALETTE_VALUE = '4-color.act';
const NO_PALETTE_VALUE = '__none__';
const PREVIEW_START_LABEL = '开始预览（Tab）';
const PREVIEW_CLOSE_LABEL = '关闭预览（Tab）';
const DITHER_ALGORITHM_TOOLTIPS = {
    'floyd-steinberg': 'Floyd Steinberg：经典扩散，细节保留强，对比鲜明。优点：层次感好、通用性强。缺点：噪点更重，黑白图更容易显脏。',
    'false-floyd-steinberg': 'False Floyd Steinberg：比 Floyd 更轻量，颗粒更规整。优点：速度快、噪点略少。缺点：细节和过渡通常不如 Floyd 自然。',
    'minimized-average-error': 'Minimized Average Error：扩散范围较大，整体更平滑。优点：大面积渐变更柔和。缺点：纹理感偏强，算法更重。',
    stucki: 'Stucki：高质量大核扩散。优点：层次平滑、细节丰富。缺点：颗粒更密，容易出现明显纹理。',
    atkinson: 'Atkinson：更克制、更干净。优点：黑白设备、图标、文字感内容通常更舒服。缺点：细节会比 Floyd 少一点。',
    burkes: 'Burkes：在细节和干净度之间比较均衡。优点：常作为 Floyd 的柔和替代。缺点：极端高对比下仍会有颗粒感。',
    sierra: 'Sierra：扩散更宽，过渡更自然。优点：灰阶和平滑区域表现好。缺点：有时会显得偏软，纹理感略重。',
    'two-row': 'Two Row：两行扩散，计算量适中。优点：比 Floyd 更稳一点，速度和效果平衡。缺点：极细节表现通常不如大核算法。',
    'sierra-lite': 'Sierra Lite：轻量、克制。优点：速度快，颗粒较少，适合资源受限场景。缺点：过渡和细节通常弱于 Floyd / Burkes。'
};

const DITHER_ALGORITHM_LABELS = {
    'floyd-steinberg': 'Floyd Steinberg',
    'false-floyd-steinberg': 'False Floyd Steinberg',
    'minimized-average-error': 'Minimized Average Error',
    stucki: 'Stucki',
    atkinson: 'Atkinson',
    burkes: 'Burkes',
    sierra: 'Sierra',
    'two-row': 'Two Row',
    'sierra-lite': 'Sierra Lite'
};

async function initializePaletteOptions() {
    const manifestUrl = './act/palettes.json';
    let actFiles = [];

    try {
        const response = await fetch(manifestUrl, { cache: 'no-store' });
        if (response.ok) {
            const manifest = await response.json();
            if (Array.isArray(manifest)) {
                actFiles = manifest.filter((name) => typeof name === 'string');
            } else if (Array.isArray(manifest?.palettes)) {
                actFiles = manifest.palettes
                    .map((entry) => (typeof entry === 'string' ? entry : entry?.file))
                    .filter((name) => typeof name === 'string');
            }
        }
    } catch {
        // manifest missing is allowed, keep fallback options
    }

    if (actFiles.length) {
        refs.paletteSelect.innerHTML = '';
        const noneOption = document.createElement('option');
        noneOption.value = NO_PALETTE_VALUE;
        noneOption.textContent = '不使用调色板';
        refs.paletteSelect.appendChild(noneOption);

        actFiles.forEach((filename) => {
            const option = document.createElement('option');
            option.value = filename;
            option.textContent = filename;
            refs.paletteSelect.appendChild(option);
        });
    }

    await preloadPalettesFromManifest(
        Array.from(refs.paletteSelect.options)
            .map((option) => option.value)
            .filter((value) => value && value !== NO_PALETTE_VALUE),
        './act/'
    );

    const availableValues = new Set(Array.from(refs.paletteSelect.options).map((option) => option.value));
    if (availableValues.has(DEFAULT_PALETTE_VALUE)) {
        refs.paletteSelect.value = DEFAULT_PALETTE_VALUE;
    } else if (!availableValues.has(refs.paletteSelect.value)) {
        refs.paletteSelect.value = availableValues.has(NO_PALETTE_VALUE)
            ? NO_PALETTE_VALUE
            : (refs.paletteSelect.options[0]?.value || '');
    }
}

function isTypingElement(target) {
    return Boolean(target) && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
    );
}

function isTextEntryElement(target) {
    if (!target) {
        return false;
    }

    if (target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return true;
    }

    if (target.tagName !== 'INPUT') {
        return false;
    }

    const inputType = (target.getAttribute('type') || '').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'radio', 'range', 'reset', 'submit'].includes(inputType);
}

function syncOuterMaskWithPreviewMode() {
    const shouldShowOuterMask = state.previewMode === 'fit';
    state.showOuterMask = shouldShowOuterMask;
    if (refs.showOuterMaskInput) {
        refs.showOuterMaskInput.checked = shouldShowOuterMask;
    }
    updateOverlayVisibility();
}

function isPreviewModeActive() {
    return state.previewMode === 'actual';
}

function updatePreviewToggleButtonText() {
    if (!refs.previewToggleBtn) {
        return;
    }

    refs.previewToggleBtn.textContent = isPreviewModeActive() ? PREVIEW_CLOSE_LABEL : PREVIEW_START_LABEL;
    refs.previewToggleBtn.classList.toggle('is-active', isPreviewModeActive());
    refs.previewToggleBtn.disabled = !state.cropper || !state.targetWidth || !state.targetHeight;
}

function updateOrientationButtonText() {
    if (!refs.swapDimensionsBtn) {
        return;
    }

    const width = Number.parseInt(refs.widthInput.value, 10) || state.targetWidth || 0;
    const height = Number.parseInt(refs.heightInput.value, 10) || state.targetHeight || 0;

    refs.swapDimensionsBtn.textContent = width > height ? '切换竖屏（Q）' : '切换横屏（Q）';
}

function getDitherAlgorithmTooltipText(algorithmName) {
    return DITHER_ALGORITHM_TOOLTIPS[algorithmName] || '';
}

function showDitherAlgorithmTooltip(target, algorithmName) {
    if (!refs.ditherAlgorithmTooltip || !target) {
        return;
    }

    refs.ditherAlgorithmTooltip.textContent = getDitherAlgorithmTooltipText(algorithmName);
    refs.ditherAlgorithmTooltip.hidden = false;

    const tooltipRect = refs.ditherAlgorithmTooltip.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const gap = 10;
    let left = targetRect.right + gap;
    let top = targetRect.top;

    if (left + tooltipRect.width > window.innerWidth - 12) {
        left = Math.max(12, targetRect.left - tooltipRect.width - gap);
    }
    if (top + tooltipRect.height > window.innerHeight - 12) {
        top = Math.max(12, window.innerHeight - tooltipRect.height - 12);
    }

    refs.ditherAlgorithmTooltip.style.left = `${left}px`;
    refs.ditherAlgorithmTooltip.style.top = `${top}px`;
}

function hideDitherAlgorithmTooltip() {
    if (!refs.ditherAlgorithmTooltip) {
        return;
    }
    refs.ditherAlgorithmTooltip.hidden = true;
}

function syncDitherAlgorithmUI() {
    if (refs.ditherAlgorithmTrigger) {
        const algorithmName = refs.ditherAlgorithmSelect?.value || DEFAULT_DITHER_ALGORITHM;
        refs.ditherAlgorithmTrigger.textContent = DITHER_ALGORITHM_LABELS[algorithmName] || '选择算法';
    }

    refs.ditherAlgorithmOptions?.querySelectorAll('.custom-select-option').forEach((option) => {
        option.classList.toggle('is-active', option.dataset.value === refs.ditherAlgorithmSelect?.value);
    });

}

function setScanMode(nextMode) {
    const normalized = nextMode === 'raster' ? 'raster' : 'serpentine';
    state.scanMode = normalized;
    refs.scanModeRasterBtn?.classList.toggle('is-active', normalized === 'raster');
    refs.scanModeSerpentineBtn?.classList.toggle('is-active', normalized === 'serpentine');
}

function isSerpentineScanEnabled() {
    return state.scanMode !== 'raster';
}

function closeDitherAlgorithmMenu() {
    if (!refs.ditherAlgorithmMenu || !refs.ditherAlgorithmTrigger) {
        return;
    }
    refs.ditherAlgorithmMenu.hidden = true;
    refs.ditherAlgorithmTrigger.setAttribute('aria-expanded', 'false');
    refs.ditherAlgorithmPicker?.classList.remove('is-open');
    refs.sidePanel?.classList.remove('is-popover-open');
    hideDitherAlgorithmTooltip();
}

function openDitherAlgorithmMenu() {
    if (!refs.ditherAlgorithmMenu || !refs.ditherAlgorithmTrigger || refs.ditherAlgorithmTrigger.disabled) {
        return;
    }
    refs.ditherAlgorithmMenu.hidden = false;
    refs.ditherAlgorithmTrigger.setAttribute('aria-expanded', 'true');
    refs.ditherAlgorithmPicker?.classList.add('is-open');
    refs.sidePanel?.classList.add('is-popover-open');
    syncDitherAlgorithmUI();
}

function updatePreviewEditingLockState() {
    const previewActive = isPreviewModeActive();
    refs.editorStage?.classList.toggle('preview-mode-active', previewActive);

    if (state.cropper) {
        state.cropper.setDragMode(previewActive ? 'none' : 'move');
    }

    [
        refs.rotateLeftBtn,
        refs.rotateRightBtn,
        refs.flipHBtn,
        refs.flipVBtn,
        refs.fitToCropBtn,
        refs.resetBtn,
        refs.zoomInput
    ].forEach((control) => {
        if (control) {
            control.disabled = previewActive || !state.cropper;
        }
    });

    updatePreviewToggleButtonText();
    updateOrientationButtonText();
    refs.scanModeRasterBtn && (refs.scanModeRasterBtn.disabled = !refs.ditherEnabledInput.checked);
    refs.scanModeSerpentineBtn && (refs.scanModeSerpentineBtn.disabled = !refs.ditherEnabledInput.checked);
}

function applyPreviewMode(nextMode, options = {}) {
    const { pushHistory = true } = options;

    if (nextMode !== 'fit' && nextMode !== 'actual') {
        return;
    }

    const prevCropBoxData = state.cropper ? state.cropper.getCropBoxData() : null;
    const prevCanvasData = state.cropper ? state.cropper.getCanvasData() : null;
    state.previewMode = nextMode;
    syncOuterMaskWithPreviewMode();

    if (state.cropper) {
        applyFixedCropBox(state.previewMode === 'actual');

        const nextCropBoxData = state.cropper.getCropBoxData();
        if (
            prevCropBoxData &&
            prevCanvasData &&
            nextCropBoxData &&
            prevCropBoxData.width > 0 &&
            prevCropBoxData.height > 0
        ) {
            const relLeft = (prevCanvasData.left - prevCropBoxData.left) / prevCropBoxData.width;
            const relTop = (prevCanvasData.top - prevCropBoxData.top) / prevCropBoxData.height;
            const relWidth = prevCanvasData.width / prevCropBoxData.width;
            const relHeight = prevCanvasData.height / prevCropBoxData.height;

            state.cropper.setCanvasData({
                left: nextCropBoxData.left + relLeft * nextCropBoxData.width,
                top: nextCropBoxData.top + relTop * nextCropBoxData.height,
                width: Math.max(1, relWidth * nextCropBoxData.width),
                height: Math.max(1, relHeight * nextCropBoxData.height)
            });
        }
    }

    updatePreviewEditingLockState();
    updatePreviewCanvasPresentation();
    updateDitherUIState();
    syncZoomControls();
    schedulePreviewRender();
    persistUserSettings();
    if (pushHistory) {
        pushHistorySnapshot();
    }
}

function getHistorySnapshot() {
    const canvasData = state.cropper?.getCanvasData() || null;
    return {
        widthInput: refs.widthInput.value || '',
        heightInput: refs.heightInput.value || '',
        activePresetId: state.activePresetId || '',
        targetWidth: Number(state.targetWidth) || 0,
        targetHeight: Number(state.targetHeight) || 0,
        previewMode: state.previewMode,
        ditherEnabled: Boolean(refs.ditherEnabledInput.checked),
        palette: refs.paletteSelect.value || '4-color.act',
        backgroundColor: refs.backgroundColorInput.value || '#FFFFFF',
        backgroundHex: refs.backgroundHexInput?.value || refs.backgroundColorInput.value || '#FFFFFF',
        showOuterMask: Boolean(refs.showOuterMaskInput?.checked ?? true),
        adjustmentState: {
            exposure: Number(state.adjustmentState.exposure) || 0,
            contrast: Number(state.adjustmentState.contrast) || 0,
            saturation: Number(state.adjustmentState.saturation) || 0
        },
        currentRotation: Number(state.currentRotation) || 0,
        scaleX: Number(state.scaleX) || 1,
        scaleY: Number(state.scaleY) || 1,
        canvasData: canvasData
            ? {
                left: Number(canvasData.left) || 0,
                top: Number(canvasData.top) || 0,
                width: Number(canvasData.width) || 0,
                height: Number(canvasData.height) || 0
            }
            : null
    };
}

function isSameHistorySnapshot(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function pushHistorySnapshot() {
    if (state.isApplyingHistory) {
        return;
    }
    const snapshot = getHistorySnapshot();
    const current = state.historyStack[state.historyIndex];
    if (current && isSameHistorySnapshot(current, snapshot)) {
        return;
    }
    const nextStack = state.historyStack.slice(0, state.historyIndex + 1);
    nextStack.push(snapshot);
    if (nextStack.length > HISTORY_LIMIT) {
        nextStack.shift();
    }
    state.historyStack = nextStack;
    state.historyIndex = nextStack.length - 1;
}

function applyHistorySnapshot(snapshot) {
    if (!snapshot) {
        return;
    }
    state.isApplyingHistory = true;

    refs.widthInput.value = snapshot.widthInput;
    refs.heightInput.value = snapshot.heightInput;
    state.targetWidth = snapshot.targetWidth;
    state.targetHeight = snapshot.targetHeight;
    state.activePresetId = snapshot.activePresetId || null;
    refs.presetSizeSelect.value = snapshot.activePresetId || '';
    updateCustomSizeVisibility();

    state.previewMode = snapshot.previewMode === 'fit' ? 'fit' : 'actual';
    if (refs.ditherEnabledInput) {
        refs.ditherEnabledInput.checked = Boolean(snapshot.ditherEnabled) && snapshot.palette !== '__none__';
    }
    refs.paletteSelect.value = snapshot.palette || refs.paletteSelect.value;
    syncOuterMaskWithPreviewMode();

    setBackgroundColor(snapshot.backgroundColor || '#FFFFFF');
    if (refs.backgroundHexInput) {
        refs.backgroundHexInput.value = (snapshot.backgroundHex || '#FFFFFF').toUpperCase();
    }

    state.adjustmentState.exposure = Number(snapshot.adjustmentState?.exposure) || 0;
    state.adjustmentState.contrast = Number(snapshot.adjustmentState?.contrast) || 0;
    state.adjustmentState.saturation = Number(snapshot.adjustmentState?.saturation) || 0;
    syncAdjustmentInputs();
    updateAdjustmentValueLabels();
    updateAdjustmentPreview();

    state.currentRotation = Number(snapshot.currentRotation) || 0;
    state.scaleX = Number(snapshot.scaleX) || 1;
    state.scaleY = Number(snapshot.scaleY) || 1;

    if (state.cropper && state.targetWidth > 0 && state.targetHeight > 0) {
        state.cropper.setAspectRatio(state.targetWidth / state.targetHeight);
        applyFixedCropBox(state.previewMode === 'actual');
        if (snapshot.canvasData) {
            state.cropper.setCanvasData(snapshot.canvasData);
        }
    }

    updateInfo();
    updateOrientationButtonText();
    updatePreviewEditingLockState();
    updatePreviewCanvasPresentation();
    updateDitherUIState();
    syncZoomControls();
    schedulePreviewRender();
    persistUserSettings();
    state.isApplyingHistory = false;
}

function undoHistory() {
    if (state.historyIndex <= 0) {
        return;
    }
    state.historyIndex -= 1;
    applyHistorySnapshot(state.historyStack[state.historyIndex]);
}

function redoHistory() {
    if (state.historyIndex >= state.historyStack.length - 1) {
        return;
    }
    state.historyIndex += 1;
    applyHistorySnapshot(state.historyStack[state.historyIndex]);
}

async function triggerBackgroundEyedropperFromShortcut() {
    if (!window.EyeDropper) {
        refs.backgroundColorInput.click();
        return;
    }

    refs.editorStage?.classList.add('eyedropper-cursor');
    state.isColorPicking = true;
    state.suppressDitherPreview = true;
    updateOverlayVisibility();
    updateDitherUIState();
    schedulePreviewRender();

    try {
        await pickBackgroundColor();
    } finally {
        refs.editorStage?.classList.remove('eyedropper-cursor');
        state.isColorPicking = false;
        state.suppressDitherPreview = false;
        updateOverlayVisibility();
        updateDitherUIState();
        schedulePreviewRender();
        persistUserSettings();
        pushHistorySnapshot();
    }
}

function clampSidePanelPosition(left, top) {
    if (!refs.sidePanel) {
        return { left: 18, top: 18 };
    }

    const panelRect = refs.sidePanel.getBoundingClientRect();
    const maxLeft = Math.max(window.innerWidth - panelRect.width - 12, 12);
    const maxTop = Math.max(window.innerHeight - panelRect.height - 12, 12);

    return {
        left: Math.min(Math.max(left, 12), maxLeft),
        top: Math.min(Math.max(top, 12), maxTop)
    };
}

function setSidePanelPosition(left, top) {
    if (!refs.sidePanel) {
        return;
    }

    const clamped = clampSidePanelPosition(left, top);
    state.sidePanelPosition = clamped;
    refs.sidePanel.style.left = `${clamped.left}px`;
    refs.sidePanel.style.top = `${clamped.top}px`;
}

function initializeSidePanelPosition() {
    if (!refs.sidePanel) {
        return;
    }

    const panelRect = refs.sidePanel.getBoundingClientRect();
    const initialLeft = Math.max(window.innerWidth - panelRect.width - 18, 12);
    setSidePanelPosition(initialLeft, 18);
}

function setWorkspacePanOffset(left, top) {
    state.workspacePanOffset = { x: left, y: top };
    if (refs.cropWorkspace) {
        refs.cropWorkspace.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }
}

function swapOrientation(options = {}) {
    const { pushHistory = true } = options;
    const width = refs.widthInput.value;
    const height = refs.heightInput.value;
    const hadActivePreset = Boolean(state.activePresetId);

    refs.widthInput.value = height;
    refs.heightInput.value = width;

    if (hadActivePreset) {
        const nextWidth = Number.parseInt(refs.widthInput.value, 10);
        const nextHeight = Number.parseInt(refs.heightInput.value, 10);
        if (nextWidth > 0 && nextHeight > 0) {
            state.targetWidth = nextWidth;
            state.targetHeight = nextHeight;
            if (state.cropper) {
                state.cropper.setAspectRatio(nextWidth / nextHeight);
                applyFixedCropBox(state.previewMode === 'actual');
                fitImageToCropBox();
                schedulePreviewRender();
            }
            updateInfo();
        }
        updateCustomSizeVisibility();
        updateOrientationButtonText();
        updatePreviewEditingLockState();
        persistUserSettings();
        if (pushHistory) {
            pushHistorySnapshot();
        }
        return;
    }

    syncPresetSelection();
    tryAutoApplyResolution();
    if (state.cropper) {
        fitImageToCropBox();
    }
    updateOrientationButtonText();
    updatePreviewEditingLockState();
    persistUserSettings();
    if (pushHistory) {
        pushHistorySnapshot();
    }
}

function persistUserSettings() {
    const ditherEnabled = refs.paletteSelect.value !== NO_PALETTE_VALUE;
    if (refs.ditherEnabledInput) {
        refs.ditherEnabledInput.checked = ditherEnabled;
    }
    const payload = {
        activePresetId: state.activePresetId || '',
        width: refs.widthInput.value || '',
        height: refs.heightInput.value || '',
        backgroundColor: refs.backgroundColorInput.value || '#FFFFFF',
        backgroundHex: refs.backgroundHexInput?.value || refs.backgroundColorInput.value || '#FFFFFF',
        showOuterMask: Boolean(refs.showOuterMaskInput?.checked ?? true),
        ditherEnabled,
        palette: refs.paletteSelect.value || '4-color.act',
        ditherAlgorithm: refs.ditherAlgorithmSelect?.value || DEFAULT_DITHER_ALGORITHM,
        scanMode: state.scanMode || 'serpentine',
        previewMode: state.previewMode,
        adjustmentState: {
            exposure: state.adjustmentState.exposure,
            contrast: state.adjustmentState.contrast,
            saturation: state.adjustmentState.saturation
        }
    };

    localStorage.setItem(constants.USER_SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}

function loadUserSettings() {
    try {
        const raw = localStorage.getItem(constants.USER_SETTINGS_STORAGE_KEY);
        if (!raw) {
            return;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        const storedWidth = parsed.width || '';
        const storedHeight = parsed.height || '';

        if (parsed.activePresetId) {
            applyPresetSelection(parsed.activePresetId);
            const currentPresetWidth = refs.widthInput.value || '';
            const currentPresetHeight = refs.heightInput.value || '';
            if (
                (storedWidth && storedHeight) &&
                (storedWidth !== currentPresetWidth || storedHeight !== currentPresetHeight)
            ) {
                refs.widthInput.value = storedWidth;
                refs.heightInput.value = storedHeight;
                selectCustomPreset();
                tryAutoApplyResolution();
            }
        } else if (storedWidth || storedHeight) {
            refs.widthInput.value = storedWidth;
            refs.heightInput.value = storedHeight;
            selectCustomPreset();
            tryAutoApplyResolution();
        }

        if (parsed.backgroundColor) {
            setBackgroundColor(parsed.backgroundColor);
        }
        if (parsed.backgroundHex) {
            const normalizedHex = normalizeHexColor(parsed.backgroundHex);
            if (normalizedHex && refs.backgroundHexInput) {
                refs.backgroundHexInput.value = normalizedHex;
            }
        }
        // showOuterMask is now controlled by preview mode automatically
        if (parsed.palette) {
            refs.paletteSelect.value = parsed.palette;
        }
        if (refs.ditherAlgorithmSelect) {
            refs.ditherAlgorithmSelect.value = parsed.ditherAlgorithm || DEFAULT_DITHER_ALGORITHM;
        }
        setScanMode(parsed.scanMode || (parsed.serpentine === false ? 'raster' : 'serpentine'));
        if (refs.ditherEnabledInput) {
            refs.ditherEnabledInput.checked = refs.paletteSelect.value !== NO_PALETTE_VALUE;
        }
        if (parsed.previewMode === 'fit' || parsed.previewMode === 'actual') {
            state.previewMode = parsed.previewMode;
        }
        if (parsed.adjustmentState && typeof parsed.adjustmentState === 'object') {
            state.adjustmentState.exposure = Number(parsed.adjustmentState.exposure) || 0;
            state.adjustmentState.contrast = Number(parsed.adjustmentState.contrast) || 0;
            state.adjustmentState.saturation = Number(parsed.adjustmentState.saturation) || 0;
        }
    } catch (error) {
        // ignore invalid local settings
    }
}

function bindFileInteractions() {
    const normalizeResolutionForImport = () => {
        if (state.activePresetId) {
            return;
        }
        const fallbackPreset = state.presetConfigs[0];
        if (!fallbackPreset?.id) {
            return;
        }
        applyPresetSelection(fallbackPreset.id);
        persistUserSettings();
    };

    refs.pickFileBtn.addEventListener('click', () => refs.fileInput.click());

    refs.dropZone.addEventListener('dragover', (event) => {
        event.preventDefault();
        refs.dropZone.classList.add('drag-over');
    });

    refs.dropZone.addEventListener('dragleave', () => {
        refs.dropZone.classList.remove('drag-over');
    });

    refs.dropZone.addEventListener('drop', (event) => {
        event.preventDefault();
        refs.dropZone.classList.remove('drag-over');
        normalizeResolutionForImport();
        loadImage(event.dataTransfer.files[0]);
        window.setTimeout(() => {
            updatePreviewEditingLockState();
            syncZoomControls();
            pushHistorySnapshot();
        }, 260);
    });

    refs.fileInput.addEventListener('change', (event) => {
        normalizeResolutionForImport();
        loadImage(event.target.files[0]);
        window.setTimeout(() => {
            updatePreviewEditingLockState();
            syncZoomControls();
            pushHistorySnapshot();
        }, 260);
    });

    document.addEventListener('paste', (event) => {
        const imageFile = getClipboardImageFile(event);
        if (!imageFile) {
            return;
        }

        const activeElement = document.activeElement;
        const isTypingTarget = activeElement &&
            (activeElement.tagName === 'INPUT' ||
                activeElement.tagName === 'TEXTAREA' ||
                activeElement.isContentEditable);

        if (isTypingTarget) {
            activeElement.blur();
        }

        event.preventDefault();
        normalizeResolutionForImport();
        loadImage(imageFile);
        window.setTimeout(() => {
            applyPreviewMode('fit', { pushHistory: false });
            fitImageToCropBox();
            updatePreviewEditingLockState();
            syncZoomControls();
            pushHistorySnapshot();
        }, 260);
    });
}

function bindResolutionControls() {
    refs.presetSizeSelect.addEventListener('change', () => {
        const value = refs.presetSizeSelect.value;

        if (value === constants.PRESET_MANAGE_VALUE) {
            refs.presetSizeSelect.value = state.activePresetId || '';
            updateCustomSizeVisibility();
            openPresetManager();
            persistUserSettings();
            return;
        }

        if (!value) {
            selectCustomPreset();
            persistUserSettings();
            pushHistorySnapshot();
            return;
        }

        applyPresetSelection(value);
        updateOrientationButtonText();
        updatePreviewEditingLockState();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.swapDimensionsBtn.addEventListener('click', () => swapOrientation());

    refs.widthInput.addEventListener('input', () => {
        syncPresetSelection();
        tryAutoApplyResolution();
        updateOrientationButtonText();
        updatePreviewEditingLockState();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.heightInput.addEventListener('input', () => {
        syncPresetSelection();
        tryAutoApplyResolution();
        updateOrientationButtonText();
        updatePreviewEditingLockState();
        persistUserSettings();
        pushHistorySnapshot();
    });
}

function bindAdjustmentControls() {
    refs.backgroundColorInput.addEventListener('input', () => {
        setBackgroundColor(refs.backgroundColorInput.value);
        if (refs.backgroundHexInput) {
            refs.backgroundHexInput.value = refs.backgroundColorInput.value.toUpperCase();
        }
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.backgroundHexInput?.addEventListener('input', () => {
        const normalized = normalizeHexColor(refs.backgroundHexInput.value);
        if (normalized) {
            refs.backgroundColorInput.value = normalized;
            refs.backgroundHexInput.value = normalized;
            schedulePreviewRender();
            persistUserSettings();
            pushHistorySnapshot();
        }
    });

    refs.backgroundHexInput?.addEventListener('blur', () => {
        refs.backgroundHexInput.value = refs.backgroundColorInput.value.toUpperCase();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.ditherEnabledInput?.addEventListener('change', () => {
        updateDitherUIState();
        schedulePreviewRender();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.backgroundColorInput.addEventListener('pointerdown', () => {
        state.isColorPicking = true;
        state.suppressDitherPreview = true;
        refs.editorStage?.classList.add('eyedropper-cursor');
        updateOverlayVisibility();
        updateDitherUIState();
        schedulePreviewRender();
    });
    refs.backgroundColorInput.addEventListener('change', () => {
        state.isColorPicking = false;
        state.suppressDitherPreview = false;
        refs.editorStage?.classList.remove('eyedropper-cursor');
        updateOverlayVisibility();
        updateDitherUIState();
        schedulePreviewRender();
    });
    refs.backgroundColorInput.addEventListener('blur', () => {
        state.isColorPicking = false;
        state.suppressDitherPreview = false;
        refs.editorStage?.classList.remove('eyedropper-cursor');
        updateOverlayVisibility();
        updateDitherUIState();
        schedulePreviewRender();
    });

    refs.previewToggleBtn?.addEventListener('click', () => {
        applyPreviewMode(isPreviewModeActive() ? 'fit' : 'actual');
    });

    refs.paletteSelect.addEventListener('change', () => {
        if (refs.ditherEnabledInput) {
            refs.ditherEnabledInput.checked = refs.paletteSelect.value !== NO_PALETTE_VALUE;
        }
        schedulePreviewRender();
        updateDitherUIState();
        syncDitherAlgorithmUI();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.ditherAlgorithmSelect?.addEventListener('change', () => {
        schedulePreviewRender();
        updateDitherUIState();
        syncDitherAlgorithmUI();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.ditherAlgorithmTrigger?.addEventListener('click', () => {
        if (refs.ditherAlgorithmMenu?.hidden) {
            openDitherAlgorithmMenu();
        } else {
            closeDitherAlgorithmMenu();
        }
    });

    refs.ditherAlgorithmTrigger?.addEventListener('mouseenter', () => {
        showDitherAlgorithmTooltip(refs.ditherAlgorithmTrigger, refs.ditherAlgorithmSelect?.value || DEFAULT_DITHER_ALGORITHM);
    });
    refs.ditherAlgorithmTrigger?.addEventListener('mouseleave', () => {
        if (refs.ditherAlgorithmMenu?.hidden) {
            hideDitherAlgorithmTooltip();
        }
    });
    refs.ditherAlgorithmTrigger?.addEventListener('focus', () => {
        showDitherAlgorithmTooltip(refs.ditherAlgorithmTrigger, refs.ditherAlgorithmSelect?.value || DEFAULT_DITHER_ALGORITHM);
    });
    refs.ditherAlgorithmTrigger?.addEventListener('blur', () => {
        if (refs.ditherAlgorithmMenu?.hidden) {
            hideDitherAlgorithmTooltip();
        }
    });

    refs.ditherAlgorithmOptions?.querySelectorAll('.custom-select-option').forEach((option) => {
        option.addEventListener('mouseenter', () => {
            const algorithmName = option.dataset.value || DEFAULT_DITHER_ALGORITHM;
            showDitherAlgorithmTooltip(option, algorithmName);
        });

        option.addEventListener('focus', () => {
            const algorithmName = option.dataset.value || DEFAULT_DITHER_ALGORITHM;
            showDitherAlgorithmTooltip(option, algorithmName);
        });

        option.addEventListener('mouseleave', () => {
            hideDitherAlgorithmTooltip();
        });

        option.addEventListener('blur', () => {
            hideDitherAlgorithmTooltip();
        });

        option.addEventListener('click', () => {
            if (refs.ditherAlgorithmSelect) {
                refs.ditherAlgorithmSelect.value = option.dataset.value || DEFAULT_DITHER_ALGORITHM;
                refs.ditherAlgorithmSelect.dispatchEvent(new Event('change', { bubbles: true }));
            }
            closeDitherAlgorithmMenu();
        });
    });

    refs.scanModeRasterBtn?.addEventListener('click', () => {
        setScanMode('raster');
        schedulePreviewRender();
        updateDitherUIState();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.scanModeSerpentineBtn?.addEventListener('click', () => {
        setScanMode('serpentine');
        schedulePreviewRender();
        updateDitherUIState();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.exposureInput.addEventListener('input', () => {
        state.adjustmentState.exposure = Number.parseInt(refs.exposureInput.value, 10) || 0;
        updateAdjustmentValueLabels();
        updateAdjustmentPreview();
        schedulePreviewRender();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.contrastInput.addEventListener('input', () => {
        state.adjustmentState.contrast = Number.parseInt(refs.contrastInput.value, 10) || 0;
        updateAdjustmentValueLabels();
        updateAdjustmentPreview();
        schedulePreviewRender();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.saturationInput.addEventListener('input', () => {
        state.adjustmentState.saturation = Number.parseInt(refs.saturationInput.value, 10) || 0;
        updateAdjustmentValueLabels();
        updateAdjustmentPreview();
        schedulePreviewRender();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.resetAdjustmentsBtn.addEventListener('click', () => {
        resetAdjustments();
        schedulePreviewRender();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.zoomInput?.addEventListener('input', () => {
        if (refs.zoomInput.disabled) {
            return;
        }
        if (applyZoomPercent(Number.parseInt(refs.zoomInput.value, 10) || 100)) {
            persistUserSettings();
        }
    });

    refs.zoomInput?.addEventListener('change', () => {
        if (!refs.zoomInput.disabled) {
            pushHistorySnapshot();
        }
    });
}

function bindEditorActions() {
    refs.exportBtn.addEventListener('click', exportBMP);
    refs.resetBtn.addEventListener('click', () => {
        resetEditor();
        updatePreviewEditingLockState();
        pushHistorySnapshot();
    });
    refs.newImageBtn.addEventListener('click', () => {
        clearAll();
        updatePreviewEditingLockState();
        pushHistorySnapshot();
    });

    refs.rotateLeftBtn.addEventListener('click', () => {
        if (!state.cropper) {
            return;
        }

        state.currentRotation -= 90;
        state.cropper.rotate(-90);
        applyFixedCropBox();
        updateInfo();
        syncZoomControls();
        schedulePreviewRender();
        pushHistorySnapshot();
    });

    refs.rotateRightBtn.addEventListener('click', () => {
        if (!state.cropper) {
            return;
        }

        state.currentRotation += 90;
        state.cropper.rotate(90);
        applyFixedCropBox();
        updateInfo();
        syncZoomControls();
        schedulePreviewRender();
        pushHistorySnapshot();
    });

    refs.flipHBtn.addEventListener('click', () => {
        if (!state.cropper) {
            return;
        }

        state.scaleX *= -1;
        state.cropper.scaleX(state.scaleX);
        applyFixedCropBox();
        syncZoomControls();
        schedulePreviewRender();
        pushHistorySnapshot();
    });

    refs.flipVBtn.addEventListener('click', () => {
        if (!state.cropper) {
            return;
        }

        state.scaleY *= -1;
        state.cropper.scaleY(state.scaleY);
        applyFixedCropBox();
        syncZoomControls();
        schedulePreviewRender();
        pushHistorySnapshot();
    });

    refs.fitToCropBtn.addEventListener('click', () => {
        if (fitImageToCropBox()) {
            pushHistorySnapshot();
        }
    });

}

function bindKeyboardShortcuts() {
    const HANDLED_SHORTCUT_FLAG = '__qspShortcutHandled';

    const handleGlobalShortcuts = (event) => {
        if (event[HANDLED_SHORTCUT_FLAG]) {
            return true;
        }
        const key = event.key.toLowerCase();
        const isMod = event.ctrlKey || event.metaKey;

        if (!isMod) {
            return false;
        }

        const activeElement = document.activeElement;
        const isTypingTarget = isTypingElement(activeElement);

        if (key === 's') {
            event[HANDLED_SHORTCUT_FLAG] = true;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.returnValue = false;
            exportBMP();
            return true;
        }

        if (key === 'n') {
            event[HANDLED_SHORTCUT_FLAG] = true;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.returnValue = false;
            clearAll();
            pushHistorySnapshot();
            return true;
        }

        if (key === 'b') {
            event[HANDLED_SHORTCUT_FLAG] = true;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.returnValue = false;
            triggerBackgroundEyedropperFromShortcut();
            return true;
        }

        if (key === 'z') {
            if (isTypingTarget) {
                return false;
            }
            event[HANDLED_SHORTCUT_FLAG] = true;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.returnValue = false;
            if (event.shiftKey) {
                redoHistory();
            } else {
                undoHistory();
            }
            return true;
        }

        if (key === 'y') {
            if (isTypingTarget) {
                return false;
            }
            event[HANDLED_SHORTCUT_FLAG] = true;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.returnValue = false;
            redoHistory();
            return true;
        }

        return false;
    };

    const handleToolbarShortcuts = (event) => {
        if (event[HANDLED_SHORTCUT_FLAG]) {
            return true;
        }

        const activeElement = document.activeElement;
        const target = event.target;
        const key = event.key.toLowerCase();

        if (isTextEntryElement(activeElement) || isTextEntryElement(target)) {
            return false;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey && key === 'q') {
            event[HANDLED_SHORTCUT_FLAG] = true;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.returnValue = false;
            swapOrientation();
            return true;
        }

        if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab') {
            event[HANDLED_SHORTCUT_FLAG] = true;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            event.returnValue = false;
            applyPreviewMode(isPreviewModeActive() ? 'fit' : 'actual');
            return true;
        }

        return false;
    };

    // Capture stage interception to beat browser defaults like Ctrl+N.
    window.addEventListener('keydown', (event) => {
        if (handleToolbarShortcuts(event)) {
            return;
        }
        handleGlobalShortcuts(event);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (handleGlobalShortcuts(event)) {
            return;
        }

        const activeElement = document.activeElement;
        const isTypingTarget = isTypingElement(activeElement);
        const key = event.key.toLowerCase();

        if (!state.cropper) {
            return;
        }

        if (isPreviewModeActive()) {
            return;
        }

        if ((event.ctrlKey || event.metaKey) && key === 'r') {
            event.preventDefault();
            resetEditor();
            pushHistorySnapshot();
            return;
        }

        if (key === '+' || key === '=') {
            event.preventDefault();
            state.cropper.zoom(0.1);
            applyFixedCropBox();
            schedulePreviewRender();
            pushHistorySnapshot();
            return;
        }

        if (key === '-') {
            event.preventDefault();
            state.cropper.zoom(-0.1);
            applyFixedCropBox();
            schedulePreviewRender();
            pushHistorySnapshot();
            return;
        }

        if (key === 'arrowleft') {
            event.preventDefault();
            state.cropper.move(-2, 0);
        } else if (key === 'arrowright') {
            event.preventDefault();
            state.cropper.move(2, 0);
        } else if (key === 'arrowup') {
            event.preventDefault();
            state.cropper.move(0, -2);
        } else if (key === 'arrowdown') {
            event.preventDefault();
            state.cropper.move(0, 2);
        } else {
            return;
        }

        applyFixedCropBox();
        schedulePreviewRender();
        pushHistorySnapshot();
    });

    window.addEventListener('blur', () => {
        state.workspacePanState = null;
        refs.editorStage.classList.remove('workspace-panning');
    });
}

function fitImageToCropBox() {
    if (!state.cropper) {
        return false;
    }

    const cropBoxData = state.cropper.getCropBoxData();
    const canvasData = state.cropper.getCanvasData();

    if (!cropBoxData || !canvasData || !canvasData.width || !canvasData.height) {
        return false;
    }

    const scaleFactor = Math.max(
        cropBoxData.width / canvasData.width,
        cropBoxData.height / canvasData.height
    );

    const nextWidth = canvasData.width * scaleFactor;
    const nextHeight = canvasData.height * scaleFactor;
    const cropCenterX = cropBoxData.left + cropBoxData.width / 2;
    const cropCenterY = cropBoxData.top + cropBoxData.height / 2;

    state.cropper.setCanvasData({
        left: cropCenterX - nextWidth / 2,
        top: cropCenterY - nextHeight / 2,
        width: nextWidth,
        height: nextHeight
    });

    applyFixedCropBox(state.previewMode === 'actual');
    syncZoomControls();
    schedulePreviewRender();
    return true;
}

function bindWindowInteractions() {
    window.addEventListener('wheel', (event) => {
        if (event.ctrlKey) {
            event.preventDefault();
        }
    }, { passive: false });

    refs.editorStage?.addEventListener('wheel', (event) => {
        if (!isPreviewModeActive()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }, { passive: false, capture: true });

    refs.editorStage?.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    refs.sidePanel?.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    document.addEventListener('pointerdown', (event) => {
        if (!refs.ditherAlgorithmPicker?.contains(event.target)) {
            closeDitherAlgorithmMenu();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeDitherAlgorithmMenu();
        }
    });

    window.addEventListener('resize', () => {
        clearTimeout(state.resizeTimer);
        state.resizeTimer = window.setTimeout(() => {
            if (state.cropper) {
                applyFixedCropBox(state.previewMode === 'actual');
                syncZoomControls();
                schedulePreviewRender();
                setFloatingPreviewPosition(state.previewPosition.left, state.previewPosition.top);
            } else {
                updateOverlayMask(0, 0);
            }
            if (state.sidePanelPosition) {
                setSidePanelPosition(state.sidePanelPosition.left, state.sidePanelPosition.top);
            } else {
                initializeSidePanelPosition();
            }
        }, 120);
    });

    refs.sidePanel?.addEventListener('pointerdown', (event) => {
        if (!refs.sidePanel) {
            return;
        }
        const interactiveTarget = event.target.closest(
            'button, input, select, textarea, label, a, [role="button"]'
        );
        if (interactiveTarget) {
            return;
        }
        event.preventDefault();
        const rect = refs.sidePanel.getBoundingClientRect();
        state.sidePanelDragState = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
        };
        refs.sidePanel.classList.add('dragging');
        document.body.style.cursor = 'move';
        document.body.style.userSelect = 'none';
    });

    refs.floatingPreview?.addEventListener('pointerdown', (event) => {
        if (!refs.ditherEnabledInput.checked || !state.cropper) {
            return;
        }

        event.preventDefault();
        const rect = refs.floatingPreview.getBoundingClientRect();
        state.previewDragState = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
        };
        refs.floatingPreview.classList.add('dragging');
        document.body.style.cursor = 'move';
        document.body.style.userSelect = 'none';
    });

    refs.floatingPreview?.addEventListener('dragstart', (event) => {
        event.preventDefault();
    });

    window.addEventListener('pointerdown', (event) => {
        if (event.button !== 2) {
            return;
        }
        const stageRect = refs.editorStage.getBoundingClientRect();
        const insideStage =
            event.clientX >= stageRect.left &&
            event.clientX <= stageRect.right &&
            event.clientY >= stageRect.top &&
            event.clientY <= stageRect.bottom;
        if (!insideStage) {
            return;
        }

        event.preventDefault();
        state.workspacePanState = {
            startX: event.clientX,
            startY: event.clientY,
            originX: state.workspacePanOffset.x,
            originY: state.workspacePanOffset.y
        };
        refs.editorStage.classList.add('workspace-panning');
        document.body.style.cursor = 'move';
        document.body.style.userSelect = 'none';
    }, true);

    refs.editorStage.addEventListener('dblclick', () => {
        if (isPreviewModeActive()) {
            return;
        }
        fitImageToCropBox();
    });

    window.addEventListener('pointermove', (event) => {
        if (state.workspacePanState) {
            event.preventDefault();
            const nextX = state.workspacePanState.originX + (event.clientX - state.workspacePanState.startX);
            const nextY = state.workspacePanState.originY + (event.clientY - state.workspacePanState.startY);
            setWorkspacePanOffset(nextX, nextY);
            return;
        }

        if (state.sidePanelDragState) {
            event.preventDefault();
            const left = event.clientX - state.sidePanelDragState.offsetX;
            const top = event.clientY - state.sidePanelDragState.offsetY;
            setSidePanelPosition(left, top);
            return;
        }

        if (!state.previewDragState) {
            return;
        }

        event.preventDefault();
        const left = event.clientX - state.previewDragState.offsetX;
        const top = event.clientY - state.previewDragState.offsetY;
        setFloatingPreviewPosition(left, top);
    });

    window.addEventListener('pointerup', () => {
        state.workspacePanState = null;
        refs.editorStage.classList.remove('workspace-panning');
        state.sidePanelDragState = null;
        refs.sidePanel?.classList.remove('dragging');
        stopPreviewDrag();
        if (state.cropper) {
            pushHistorySnapshot();
        }
    });

    window.addEventListener('pointercancel', () => {
        state.workspacePanState = null;
        refs.editorStage.classList.remove('workspace-panning');
        state.sidePanelDragState = null;
        refs.sidePanel?.classList.remove('dragging');
        stopPreviewDrag();
    });
}

async function initialize() {
    appendFloatingPreviewToBody();
    initializePresetManager();
    await initializePaletteOptions();
    loadUserSettings();
    bindFileInteractions();
    bindResolutionControls();
    bindAdjustmentControls();
    bindEditorActions();
    bindKeyboardShortcuts();
    bindWindowInteractions();

    updateInfo();
    updateCustomSizeVisibility();
    if (refs.ditherAlgorithmSelect && !refs.ditherAlgorithmSelect.value) {
        refs.ditherAlgorithmSelect.value = DEFAULT_DITHER_ALGORITHM;
    }
    setScanMode(state.scanMode || 'serpentine');
    updateDitherUIState();
    syncDitherAlgorithmUI();
    syncOuterMaskWithPreviewMode();
    updateOrientationButtonText();
    updatePreviewEditingLockState();
    if (refs.ditherEnabledInput) {
        refs.ditherEnabledInput.checked = refs.paletteSelect.value !== NO_PALETTE_VALUE;
    }
    syncAdjustmentInputs();
    state.targetWidth = Number.parseInt(refs.widthInput.value, 10) || 0;
    state.targetHeight = Number.parseInt(refs.heightInput.value, 10) || 0;
    updateOverlayMask(0, 0);
    setFloatingPreviewPosition(state.previewPosition.left, state.previewPosition.top);
    initializeSidePanelPosition();
    setWorkspacePanOffset(0, 0);
    syncZoomControls();
    persistUserSettings();
    pushHistorySnapshot();
}

initialize();
