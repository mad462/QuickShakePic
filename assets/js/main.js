import { syncAdjustmentInputs, resetAdjustments, updateAdjustmentPreview, updateAdjustmentValueLabels } from './image-processing.js?v=20260417';
import { preloadPalettesFromManifest } from './image-processing.js?v=20260417';
import {
    appendFloatingPreviewToBody,
    constants,
    refs,
    state
} from './state.js?v=20260417';
import {
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
    stopPreviewDrag,
    syncPresetSelection,
    tryAutoApplyResolution,
    updateCustomSizeVisibility,
    updateOverlayVisibility,
    updatePreviewCanvasPresentation,
    updateDitherUIState,
    updateInfo,
    updateOverlayMask
} from './editor.js?v=20260417';
import {
    applyPresetSelection,
    initializePresetManager,
    openPresetManager,
    selectCustomPreset
} from './preset-manager.js?v=20260417';
import { normalizeHexColor } from './utils.js?v=20260417';

const HISTORY_LIMIT = 80;

const DEFAULT_PALETTE_VALUE = '4-color.act';
const NO_PALETTE_VALUE = '__none__';

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

function syncOuterMaskWithPreviewMode() {
    const shouldShowOuterMask = state.previewMode === 'fit';
    state.showOuterMask = shouldShowOuterMask;
    if (refs.showOuterMaskInput) {
        refs.showOuterMaskInput.checked = shouldShowOuterMask;
    }
    updateOverlayVisibility();
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
    updatePreviewCanvasPresentation();
    updateDitherUIState();
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
        window.setTimeout(pushHistorySnapshot, 260);
    });

    refs.fileInput.addEventListener('change', (event) => {
        normalizeResolutionForImport();
        loadImage(event.target.files[0]);
        window.setTimeout(pushHistorySnapshot, 260);
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
        window.setTimeout(pushHistorySnapshot, 260);
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
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.swapDimensionsBtn.addEventListener('click', () => {
        const width = refs.widthInput.value;
        const height = refs.heightInput.value;
        const hadActivePreset = Boolean(state.activePresetId);

        refs.widthInput.value = height;
        refs.heightInput.value = width;

        // When current selection is a preset, keep preset mode after swap
        // instead of downgrading to manual mode when reverse size has no preset.
        if (hadActivePreset) {
            const nextWidth = Number.parseInt(refs.widthInput.value, 10);
            const nextHeight = Number.parseInt(refs.heightInput.value, 10);
            if (nextWidth > 0 && nextHeight > 0) {
                state.targetWidth = nextWidth;
                state.targetHeight = nextHeight;
                if (state.cropper) {
                    state.cropper.setAspectRatio(nextWidth / nextHeight);
                    applyFixedCropBox();
                    schedulePreviewRender();
                }
                updateInfo();
            }
            updateCustomSizeVisibility();
            persistUserSettings();
            pushHistorySnapshot();
            return;
        }

        syncPresetSelection();
        tryAutoApplyResolution();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.widthInput.addEventListener('input', () => {
        syncPresetSelection();
        tryAutoApplyResolution();
        persistUserSettings();
        pushHistorySnapshot();
    });

    refs.heightInput.addEventListener('input', () => {
        syncPresetSelection();
        tryAutoApplyResolution();
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

    const applyPreviewMode = (nextMode) => {
        if (nextMode !== 'fit' && nextMode !== 'actual') {
            return;
        }
        const prevCropBoxData = state.cropper ? state.cropper.getCropBoxData() : null;
        const prevCanvasData = state.cropper ? state.cropper.getCanvasData() : null;
        state.previewMode = nextMode;
        syncOuterMaskWithPreviewMode();
        if (state.cropper) {
            applyFixedCropBox();

            const nextCropBoxData = state.cropper.getCropBoxData();
            if (
                prevCropBoxData &&
                prevCanvasData &&
                nextCropBoxData &&
                prevCropBoxData.width > 0 &&
                prevCropBoxData.height > 0
            ) {
                // Keep the same composition ratio to avoid mode-toggle drift.
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
        updatePreviewCanvasPresentation();
        updateDitherUIState();
        schedulePreviewRender();
        persistUserSettings();
        pushHistorySnapshot();
    };

    refs.previewModeActualBtn?.addEventListener('click', () => applyPreviewMode('actual'));
    refs.previewModeFitBtn?.addEventListener('click', () => applyPreviewMode('fit'));

    refs.paletteSelect.addEventListener('change', () => {
        if (refs.ditherEnabledInput) {
            refs.ditherEnabledInput.checked = refs.paletteSelect.value !== NO_PALETTE_VALUE;
        }
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
}

function bindEditorActions() {
    refs.exportBtn.addEventListener('click', exportBMP);
    refs.resetBtn.addEventListener('click', () => {
        resetEditor();
        pushHistorySnapshot();
    });
    refs.newImageBtn.addEventListener('click', () => {
        clearAll();
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

    // Capture stage interception to beat browser defaults like Ctrl+N.
    window.addEventListener('keydown', (event) => {
        handleGlobalShortcuts(event);
    }, true);

    document.addEventListener('keydown', (event) => {
        if (handleGlobalShortcuts(event)) {
            return;
        }

        const activeElement = document.activeElement;
        const key = event.key.toLowerCase();

        if (!state.cropper) {
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

    applyFixedCropBox();
    schedulePreviewRender();
    return true;
}

function bindWindowInteractions() {
    window.addEventListener('wheel', (event) => {
        if (event.ctrlKey) {
            event.preventDefault();
        }
    }, { passive: false });

    refs.editorStage?.addEventListener('contextmenu', (event) => {
        event.preventDefault();
    });

    window.addEventListener('resize', () => {
        clearTimeout(state.resizeTimer);
        state.resizeTimer = window.setTimeout(() => {
            if (state.cropper) {
                applyFixedCropBox();
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
    updateDitherUIState();
    syncOuterMaskWithPreviewMode();
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
    persistUserSettings();
    pushHistorySnapshot();
}

initialize();




