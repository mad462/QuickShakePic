import {
    clearSnapState,
    destroyCropper,
    refs,
    resetTransformState,
    revokeOriginalImageURL,
    state,
    constants
} from './state.js';
import {
    applyImageAdjustmentsToCanvas,
    canvasToBMP,
    fillCanvasBackground,
    indexedToBMP,
    quantizeCanvasToIndexed,
    resetAdjustments
} from './image-processing.js';
import { normalizeHexColor } from './utils.js';

export function getTargetAspectRatio() {
    return state.targetWidth > 0 && state.targetHeight > 0
        ? state.targetWidth / state.targetHeight
        : 1;
}

export function setWorkspaceState(hasImage) {
    refs.dropZone.style.display = hasImage ? 'none' : 'flex';
    refs.cropWorkspace.classList.toggle('active', hasImage);
    refs.editorStage.classList.toggle('has-image', hasImage);
}

export function updateInfo() {
    refs.cropFrameLabel.textContent = state.targetWidth && state.targetHeight
        ? `导出 ${state.targetWidth} × ${state.targetHeight}`
        : '未设置裁剪尺寸';
}

export function updateCustomSizeVisibility() {
    refs.customSizeFields.classList.toggle('active', !state.activePresetId);
}

export function updateDitherUIState() {
    const shouldShow = Boolean(state.cropper) && refs.ditherEnabledInput.checked && !state.suppressDitherPreview;
    refs.cropFramePreview.style.display = shouldShow ? 'flex' : 'none';
    if (refs.previewModeToggleBtn) {
        refs.previewModeToggleBtn.disabled = !shouldShow;
        refs.previewModeToggleBtn.textContent = `预览模式：${state.previewMode === 'actual' ? '实际像素' : '适合视图'}`;
    }
    refs.exportBtn.textContent = refs.ditherEnabledInput.checked ? '导出8bitBMP' : '导出24bitBMP';
}

export function updateOverlayVisibility() {
    let maskOpacity = '1';
    let maskColor = 'rgba(4, 10, 18, 0.62)';

    if (state.isColorPicking) {
        maskOpacity = '0';
    } else if (!state.showOuterMask) {
        // Hide outside content completely.
        maskColor = '#040a12';
    }

    refs.maskTop.style.opacity = maskOpacity;
    refs.maskRight.style.opacity = maskOpacity;
    refs.maskBottom.style.opacity = maskOpacity;
    refs.maskLeft.style.opacity = maskOpacity;
    refs.maskTop.style.background = maskColor;
    refs.maskRight.style.background = maskColor;
    refs.maskBottom.style.background = maskColor;
    refs.maskLeft.style.background = maskColor;
}

export function updatePreviewCanvasPresentation() {
    const isFitMode = state.previewMode === 'fit';
    refs.cropFramePreview.classList.toggle('preview-fit', isFitMode);
    refs.cropFramePreview.classList.toggle('preview-actual', !isFitMode);

    if (isFitMode) {
        refs.previewCanvas.style.width = '100%';
        refs.previewCanvas.style.height = '100%';
        refs.previewCanvas.style.objectFit = 'cover';
    } else {
        // Actual-pixel preview: 1 canvas pixel = 1 CSS pixel.
        refs.previewCanvas.style.width = `${refs.previewCanvas.width}px`;
        refs.previewCanvas.style.height = `${refs.previewCanvas.height}px`;
        refs.previewCanvas.style.objectFit = 'unset';
    }
    refs.previewCanvas.style.transform = 'translate3d(0, 0, 0)';
}

export function setBackgroundColor(color) {
    const normalized = normalizeHexColor(color);
    if (!normalized) {
        return false;
    }

    refs.backgroundColorInput.value = normalized;
    refs.backgroundHexInput.value = normalized;
    schedulePreviewRender();
    return true;
}

export function clampFloatingPreviewPosition(left, top) {
    if (!refs.floatingPreview) {
        return { left: 12, top: 12 };
    }
    const previewRect = refs.floatingPreview.getBoundingClientRect();
    const maxLeft = Math.max(window.innerWidth - previewRect.width - 12, 12);
    const maxTop = Math.max(window.innerHeight - previewRect.height - 12, 12);

    return {
        left: Math.min(Math.max(left, 12), maxLeft),
        top: Math.min(Math.max(top, 12), maxTop)
    };
}

export function setFloatingPreviewPosition(left, top) {
    if (!refs.floatingPreview) {
        return;
    }
    const clamped = clampFloatingPreviewPosition(left, top);
    state.previewPosition = clamped;
    refs.floatingPreview.style.transform = `translate3d(${clamped.left}px, ${clamped.top}px, 0)`;
}

export function updateOverlayMask(frameWidth, frameHeight) {
    const stageRect = refs.editorStage.getBoundingClientRect();
    const left = (stageRect.width - frameWidth) / 2;
    const top = (stageRect.height - frameHeight) / 2;
    const right = left + frameWidth;
    const bottom = top + frameHeight;

    refs.maskTop.style.left = '0px';
    refs.maskTop.style.top = '0px';
    refs.maskTop.style.width = '100%';
    refs.maskTop.style.height = `${Math.max(top, 0)}px`;

    refs.maskBottom.style.left = '0px';
    refs.maskBottom.style.top = `${Math.max(bottom, 0)}px`;
    refs.maskBottom.style.width = '100%';
    refs.maskBottom.style.height = `${Math.max(stageRect.height - bottom, 0)}px`;

    refs.maskLeft.style.left = '0px';
    refs.maskLeft.style.top = `${Math.max(top, 0)}px`;
    refs.maskLeft.style.width = `${Math.max(left, 0)}px`;
    refs.maskLeft.style.height = `${Math.max(frameHeight, 0)}px`;

    refs.maskRight.style.left = `${Math.max(right, 0)}px`;
    refs.maskRight.style.top = `${Math.max(top, 0)}px`;
    refs.maskRight.style.width = `${Math.max(stageRect.width - right, 0)}px`;
    refs.maskRight.style.height = `${Math.max(frameHeight, 0)}px`;
    updateOverlayVisibility();
}

export function getFixedCropBoxSize() {
    const stageRect = refs.editorStage.getBoundingClientRect();
    const maxWidth = Math.max(stageRect.width - 80, 120);
    const maxHeight = Math.max(stageRect.height - 110, 120);
    const aspectRatio = getTargetAspectRatio();

    if (
        state.previewMode === 'actual' &&
        state.targetWidth > 0 &&
        state.targetHeight > 0 &&
        refs.ditherEnabledInput?.checked
    ) {
        return {
            width: Math.max(80, Math.round(state.targetWidth)),
            height: Math.max(80, Math.round(state.targetHeight))
        };
    }

    let width = maxWidth;
    let height = width / aspectRatio;

    if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
    }

    // Keep strict aspect ratio to avoid tiny black gutters in preview
    // when switching orientation (contain mode is sensitive to ratio drift).
    return {
        width: Math.max(80, width),
        height: Math.max(80, height)
    };
}

export function applyFixedCropBox(shouldFitCanvas = false) {
    if (!state.cropper) {
        updateOverlayMask(0, 0);
        return;
    }

    const containerData = state.cropper.getContainerData();
    if (!containerData.width || !containerData.height) {
        return;
    }

    const { width, height } = getFixedCropBoxSize();
    state.cropper.setCropBoxData({
        left: (containerData.width - width) / 2,
        top: (containerData.height - height) / 2,
        width,
        height
    });

    if (shouldFitCanvas) {
        const canvasData = state.cropper.getCanvasData();
        const cropBoxData = state.cropper.getCropBoxData();
        if (canvasData && cropBoxData && canvasData.width > 0 && canvasData.height > 0) {
            const scaleFactor = Math.max(
                cropBoxData.width / canvasData.width,
                cropBoxData.height / canvasData.height,
                1
            );

            if (scaleFactor > 1.0001) {
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
            }
        }
    }

    refs.cropFrame.style.width = `${width}px`;
    refs.cropFrame.style.height = `${height}px`;
    updateOverlayMask(width, height);
}

export function getSnapCandidate(distanceMap) {
    let bestCandidate = null;

    Object.entries(distanceMap).forEach(([edge, distance]) => {
        const absoluteDistance = Math.abs(distance);
        if (absoluteDistance > constants.WEAK_SNAP_THRESHOLD) {
            return;
        }

        if (!bestCandidate || absoluteDistance < Math.abs(bestCandidate.distance)) {
            bestCandidate = { edge, distance };
        }
    });

    return bestCandidate;
}

export function resolveSnapEdge(axis, distances) {
    const lockedEdge = state.snapState[axis];

    if (lockedEdge) {
        const lockedDistance = distances[lockedEdge];
        if (Math.abs(lockedDistance) <= constants.WEAK_SNAP_RELEASE_THRESHOLD) {
            return {
                edge: lockedEdge,
                distance: lockedDistance
            };
        }

        state.snapState[axis] = null;
    }

    const candidate = getSnapCandidate(distances);
    if (!candidate) {
        return null;
    }

    state.snapState[axis] = candidate.edge;
    return candidate;
}

export function applyWeakSnap() {
    if (!state.cropper || state.isApplyingWeakSnap) {
        return;
    }

    const canvasData = state.cropper.getCanvasData();
    const cropBoxData = state.cropper.getCropBoxData();

    if (!canvasData || !cropBoxData) {
        return;
    }

    const horizontalSnap = resolveSnapEdge('horizontal', {
        left: canvasData.left - cropBoxData.left,
        right: (canvasData.left + canvasData.width) - (cropBoxData.left + cropBoxData.width),
        centerX: (canvasData.left + canvasData.width / 2) - (cropBoxData.left + cropBoxData.width / 2)
    });
    const verticalSnap = resolveSnapEdge('vertical', {
        top: canvasData.top - cropBoxData.top,
        bottom: (canvasData.top + canvasData.height) - (cropBoxData.top + cropBoxData.height),
        centerY: (canvasData.top + canvasData.height / 2) - (cropBoxData.top + cropBoxData.height / 2)
    });

    if (!horizontalSnap && !verticalSnap) {
        return;
    }

    const nextCanvasData = {
        left: canvasData.left,
        top: canvasData.top
    };

    if (horizontalSnap) {
        nextCanvasData.left -= horizontalSnap.distance;
    }

    if (verticalSnap) {
        nextCanvasData.top -= verticalSnap.distance;
    }

    state.isApplyingWeakSnap = true;
    state.cropper.setCanvasData(nextCanvasData);
    state.isApplyingWeakSnap = false;
}

export function initializeCropper() {
    state.cropper = new Cropper(refs.image, {
        viewMode: 0,
        dragMode: 'move',
        autoCrop: true,
        autoCropArea: 1,
        background: false,
        responsive: true,
        restore: false,
        guides: false,
        center: false,
        highlight: false,
        movable: true,
        zoomable: true,
        rotatable: true,
        scalable: true,
        cropBoxMovable: false,
        cropBoxResizable: false,
        toggleDragModeOnDblclick: false,
        wheelZoomRatio: 0.1,
        ready() {
            state.cropper.setDragMode('move');
            clearSnapState();
            applyFixedCropBox();
            updateInfo();
            updateDitherUIState();
            schedulePreviewRender();
        },
        cropmove() {
            applyWeakSnap();
            applyFixedCropBox();
            schedulePreviewRender();
        },
        zoom() {
            requestAnimationFrame(() => {
                applyFixedCropBox();
                schedulePreviewRender();
            });
        }
    });
}

export function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) {
        alert('请选择有效的图片文件。');
        return;
    }

    destroyCropper();
    revokeOriginalImageURL();

    const nextImageURL = URL.createObjectURL(file);
    refs.image.onload = () => {
        setWorkspaceState(true);
        initializeCropper();
        if (state.targetWidth && state.targetHeight) {
            state.cropper.setAspectRatio(state.targetWidth / state.targetHeight);
        }
        updateInfo();
        updateDitherUIState();
        schedulePreviewRender();
    };

    state.originalImageURL = nextImageURL;
    resetTransformState();
    state.targetWidth = Number.parseInt(refs.widthInput.value, 10) || state.targetWidth || 0;
    state.targetHeight = Number.parseInt(refs.heightInput.value, 10) || state.targetHeight || 0;
    refs.cropFrame.style.width = '0px';
    refs.cropFrame.style.height = '0px';
    refs.image.src = nextImageURL;
}

export function getClipboardImageFile(event) {
    const items = event.clipboardData?.items || [];

    for (const item of items) {
        if (item.type && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
                return file;
            }
        }
    }

    return null;
}

export function setInputsFromDimensions(width, height) {
    refs.widthInput.value = width || '';
    refs.heightInput.value = height || '';
}

export function syncPresetSelection() {
    const width = Number.parseInt(refs.widthInput.value, 10);
    const height = Number.parseInt(refs.heightInput.value, 10);

    if (!width || !height) {
        state.activePresetId = null;
        refs.presetSizeSelect.value = '';
        updateCustomSizeVisibility();
        return;
    }

    const activePreset = state.presetConfigs.find((preset) => preset.id === state.activePresetId);
    const matchedPreset = activePreset && activePreset.width === width && activePreset.height === height
        ? activePreset
        : state.presetConfigs.find((preset) => preset.width === width && preset.height === height);

    if (matchedPreset) {
        state.activePresetId = matchedPreset.id;
        refs.presetSizeSelect.value = matchedPreset.id;
    } else {
        state.activePresetId = null;
        refs.presetSizeSelect.value = '';
    }

    updateCustomSizeVisibility();
}

export function tryAutoApplyResolution() {
    const width = Number.parseInt(refs.widthInput.value, 10);
    const height = Number.parseInt(refs.heightInput.value, 10);

    if (!width || !height || width <= 0 || height <= 0) {
        return;
    }

    if (state.cropper) {
        applyResolution();
    } else {
        state.targetWidth = width;
        state.targetHeight = height;
        updateInfo();
    }
}

export function applyResolution() {
    if (!state.cropper) {
        return;
    }

    const width = Number.parseInt(refs.widthInput.value, 10);
    const height = Number.parseInt(refs.heightInput.value, 10);

    if (!width || !height || width <= 0 || height <= 0) {
        return;
    }

    state.targetWidth = width;
    state.targetHeight = height;
    state.cropper.setAspectRatio(state.targetWidth / state.targetHeight);
    applyFixedCropBox();
    syncPresetSelection();
    updateInfo();
    schedulePreviewRender();
}

export function getProcessedCanvas() {
    if (!state.cropper || !state.targetWidth || !state.targetHeight) {
        return null;
    }

    applyFixedCropBox();

    const canvas = state.cropper.getCroppedCanvas({
        width: state.targetWidth,
        height: state.targetHeight,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high'
    });

    if (!canvas) {
        return null;
    }

    const adjustedCanvas = applyImageAdjustmentsToCanvas(canvas);
    return fillCanvasBackground(adjustedCanvas, refs.backgroundColorInput.value);
}

export async function pickBackgroundColor() {
    if (!window.EyeDropper) {
        alert('当前浏览器不支持吸管取色。');
        return;
    }

    try {
        const eyeDropper = new EyeDropper();
        const result = await eyeDropper.open();
        setBackgroundColor(result.sRGBHex);
    } catch (error) {
        if (error?.name !== 'AbortError') {
            alert('取色失败，请重试。');
        }
    }
}

export function exportBMP() {
    if (!state.cropper) {
        alert('请先加载图片。');
        return;
    }

    if (!state.targetWidth || !state.targetHeight) {
        alert('请先设置裁剪尺寸。');
        return;
    }

    const canvas = getProcessedCanvas();
    if (!canvas) {
        alert('当前图片无法导出，请调整图片位置或缩放后重试。');
        return;
    }

    let bmpBuffer;
    let fileSuffix;

    if (refs.ditherEnabledInput.checked) {
        const processed = quantizeCanvasToIndexed(canvas, refs.paletteSelect.value);
        bmpBuffer = indexedToBMP(processed.width, processed.height, processed.indices, processed.palette);
        fileSuffix = `${refs.paletteSelect.value.replace('.act', '')}_floyd-steinberg_indexed8`;
    } else {
        bmpBuffer = canvasToBMP(canvas);
        fileSuffix = 'rgb24';
    }

    const blob = new Blob([bmpBuffer], { type: 'image/bmp' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crop_${state.targetWidth}x${state.targetHeight}_${fileSuffix}_${Date.now()}.bmp`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function resetEditor() {
    if (!state.cropper) {
        return;
    }

    state.cropper.reset();
    resetTransformState();
    if (state.targetWidth && state.targetHeight) {
        state.cropper.setAspectRatio(state.targetWidth / state.targetHeight);
    }
    applyFixedCropBox();
    updateInfo();
    schedulePreviewRender();
}

export function clearAll() {
    destroyCropper();
    revokeOriginalImageURL();

    refs.image.src = '';
    refs.image.style.filter = 'none';
    refs.image.onload = null;
    refs.fileInput.value = '';
    resetTransformState();
    state.targetWidth = 0;
    state.targetHeight = 0;
    resetAdjustments();
    const defaultPreset = state.presetConfigs[0] || null;
    if (defaultPreset) {
        state.activePresetId = defaultPreset.id;
        refs.widthInput.value = defaultPreset.width;
        refs.heightInput.value = defaultPreset.height;
        refs.presetSizeSelect.value = defaultPreset.id;
        state.targetWidth = defaultPreset.width;
        state.targetHeight = defaultPreset.height;
    } else {
        state.activePresetId = null;
        refs.widthInput.value = '';
        refs.heightInput.value = '';
        refs.presetSizeSelect.value = '';
    }
    updateCustomSizeVisibility();
    refs.cropFrame.style.width = '0px';
    refs.cropFrame.style.height = '0px';
    updateOverlayMask(0, 0);
    setWorkspaceState(false);
    updateInfo();
    updateDitherUIState();
}

export function renderPreview() {
    updateDitherUIState();

    if (!state.cropper || !state.targetWidth || !state.targetHeight || !refs.ditherEnabledInput.checked) {
        return;
    }

    const canvas = getProcessedCanvas();
    if (!canvas) {
        return;
    }

    const processed = quantizeCanvasToIndexed(canvas, refs.paletteSelect.value);
    refs.previewCanvas.width = processed.width;
    refs.previewCanvas.height = processed.height;
    refs.previewCanvas.getContext('2d').putImageData(processed.imageData, 0, 0);
    updatePreviewCanvasPresentation();
}

export function schedulePreviewRender() {
    clearTimeout(state.previewRenderTimer);
    state.previewRenderTimer = window.setTimeout(renderPreview, 90);
}

export function stopPreviewDrag() {
    state.previewDragState = null;
    refs.floatingPreview?.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
}



