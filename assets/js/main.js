import { syncAdjustmentInputs, resetAdjustments, updateAdjustmentPreview, updateAdjustmentValueLabels } from './image-processing.js';
import {
    appendFloatingPreviewToBody,
    constants,
    refs,
    state
} from './state.js';
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
    updateDitherUIState,
    updateInfo,
    updateOverlayMask
} from './editor.js';
import {
    applyPresetSelection,
    initializePresetManager,
    openPresetManager,
    selectCustomPreset
} from './preset-manager.js';
import { normalizeHexColor } from './utils.js';

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

function bindFileInteractions() {
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
        loadImage(event.dataTransfer.files[0]);
    });

    refs.fileInput.addEventListener('change', (event) => {
        loadImage(event.target.files[0]);
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
        loadImage(imageFile);
    });
}

function bindResolutionControls() {
    refs.presetSizeSelect.addEventListener('change', () => {
        const value = refs.presetSizeSelect.value;

        if (value === constants.PRESET_MANAGE_VALUE) {
            refs.presetSizeSelect.value = state.activePresetId || '';
            updateCustomSizeVisibility();
            openPresetManager();
            return;
        }

        if (!value) {
            selectCustomPreset();
            return;
        }

        applyPresetSelection(value);
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
            return;
        }

        syncPresetSelection();
        tryAutoApplyResolution();
    });

    refs.widthInput.addEventListener('input', () => {
        syncPresetSelection();
        tryAutoApplyResolution();
    });

    refs.heightInput.addEventListener('input', () => {
        syncPresetSelection();
        tryAutoApplyResolution();
    });
}

function bindAdjustmentControls() {
    refs.backgroundColorInput.addEventListener('input', () => {
        setBackgroundColor(refs.backgroundColorInput.value);
    });

    refs.backgroundHexInput.addEventListener('input', () => {
        const normalized = normalizeHexColor(refs.backgroundHexInput.value);
        if (normalized) {
            refs.backgroundColorInput.value = normalized;
            refs.backgroundHexInput.value = normalized;
            schedulePreviewRender();
        }
    });

    refs.backgroundHexInput.addEventListener('blur', () => {
        refs.backgroundHexInput.value = refs.backgroundColorInput.value.toUpperCase();
    });

    refs.pickColorBtn.addEventListener('click', pickBackgroundColor);

    refs.ditherEnabledInput.addEventListener('change', () => {
        updateDitherUIState();
        schedulePreviewRender();
    });

    refs.paletteSelect.addEventListener('change', schedulePreviewRender);

    refs.exposureInput.addEventListener('input', () => {
        state.adjustmentState.exposure = Number.parseInt(refs.exposureInput.value, 10) || 0;
        updateAdjustmentValueLabels();
        updateAdjustmentPreview();
        schedulePreviewRender();
    });

    refs.contrastInput.addEventListener('input', () => {
        state.adjustmentState.contrast = Number.parseInt(refs.contrastInput.value, 10) || 0;
        updateAdjustmentValueLabels();
        updateAdjustmentPreview();
        schedulePreviewRender();
    });

    refs.saturationInput.addEventListener('input', () => {
        state.adjustmentState.saturation = Number.parseInt(refs.saturationInput.value, 10) || 0;
        updateAdjustmentValueLabels();
        updateAdjustmentPreview();
        schedulePreviewRender();
    });

    refs.resetAdjustmentsBtn.addEventListener('click', () => {
        resetAdjustments();
        schedulePreviewRender();
    });
}

function bindEditorActions() {
    refs.exportBtn.addEventListener('click', exportBMP);
    refs.resetBtn.addEventListener('click', resetEditor);
    refs.newImageBtn.addEventListener('click', clearAll);

    refs.rotateLeftBtn.addEventListener('click', () => {
        if (!state.cropper) {
            return;
        }

        state.currentRotation -= 90;
        state.cropper.rotate(-90);
        applyFixedCropBox();
        updateInfo();
        schedulePreviewRender();
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
    });

    refs.flipHBtn.addEventListener('click', () => {
        if (!state.cropper) {
            return;
        }

        state.scaleX *= -1;
        state.cropper.scaleX(state.scaleX);
        applyFixedCropBox();
        schedulePreviewRender();
    });

    refs.flipVBtn.addEventListener('click', () => {
        if (!state.cropper) {
            return;
        }

        state.scaleY *= -1;
        state.cropper.scaleY(state.scaleY);
        applyFixedCropBox();
        schedulePreviewRender();
    });

}

function bindKeyboardShortcuts() {
    document.addEventListener('keydown', (event) => {
        if (!state.cropper) {
            return;
        }

        const key = event.key.toLowerCase();

        if ((event.ctrlKey || event.metaKey) && key === 'r') {
            event.preventDefault();
            resetEditor();
            return;
        }

        if (key === '+' || key === '=') {
            event.preventDefault();
            state.cropper.zoom(0.1);
            applyFixedCropBox();
            schedulePreviewRender();
            return;
        }

        if (key === '-') {
            event.preventDefault();
            state.cropper.zoom(-0.1);
            applyFixedCropBox();
            schedulePreviewRender();
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
    });
}

function bindWindowInteractions() {
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

    refs.sidePanelDragHandle?.addEventListener('pointerdown', (event) => {
        if (!refs.sidePanel) {
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

    refs.floatingPreview.addEventListener('pointerdown', (event) => {
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

    refs.floatingPreview.addEventListener('dragstart', (event) => {
        event.preventDefault();
    });

    refs.editorStage.addEventListener('dblclick', () => {
        if (!state.cropper) {
            return;
        }

        const cropBoxData = state.cropper.getCropBoxData();
        const canvasData = state.cropper.getCanvasData();

        if (!cropBoxData || !canvasData || !canvasData.width || !canvasData.height) {
            return;
        }

        // Scale proportionally so image fully covers crop frame (no stretch).
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
    });

    window.addEventListener('pointermove', (event) => {
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
        state.sidePanelDragState = null;
        refs.sidePanel?.classList.remove('dragging');
        stopPreviewDrag();
    });

    window.addEventListener('pointercancel', () => {
        state.sidePanelDragState = null;
        refs.sidePanel?.classList.remove('dragging');
        stopPreviewDrag();
    });
}

function initialize() {
    appendFloatingPreviewToBody();
    initializePresetManager();
    bindFileInteractions();
    bindResolutionControls();
    bindAdjustmentControls();
    bindEditorActions();
    bindKeyboardShortcuts();
    bindWindowInteractions();

    updateInfo();
    updateCustomSizeVisibility();
    updateDitherUIState();
    syncAdjustmentInputs();
    state.targetWidth = Number.parseInt(refs.widthInput.value, 10) || 0;
    state.targetHeight = Number.parseInt(refs.heightInput.value, 10) || 0;
    updateOverlayMask(0, 0);
    setFloatingPreviewPosition(state.previewPosition.left, state.previewPosition.top);
    initializeSidePanelPosition();
}

initialize();





