export const refs = {
    sidePanel: document.getElementById('sidePanel'),
    sidePanelDragHandle: document.getElementById('sidePanelDragHandle'),
    dropZone: document.getElementById('dropZone'),
    pickFileBtn: document.getElementById('pickFileBtn'),
    fileInput: document.getElementById('fileInput'),
    cropWorkspace: document.getElementById('cropWorkspace'),
    editorStage: document.getElementById('editorStage'),
    image: document.getElementById('image'),
    widthInput: document.getElementById('widthInput'),
    heightInput: document.getElementById('heightInput'),
    presetSizeSelect: document.getElementById('presetSize'),
    customSizeFields: document.getElementById('customSizeFields'),
    swapDimensionsBtn: document.getElementById('swapDimensionsBtn'),
    presetManagerModal: document.getElementById('presetManagerModal'),
    closePresetManagerBtn: document.getElementById('closePresetManagerBtn'),
    addPresetBtn: document.getElementById('addPresetBtn'),
    presetManagerRows: document.getElementById('presetManagerRows'),
    rotateLeftBtn: document.getElementById('rotateLeft'),
    rotateRightBtn: document.getElementById('rotateRight'),
    flipHBtn: document.getElementById('flipH'),
    flipVBtn: document.getElementById('flipV'),
    resetBtn: document.getElementById('resetBtn'),
    exportBtn: document.getElementById('exportBtn'),
    newImageBtn: document.getElementById('newImageBtn'),
    backgroundColorInput: document.getElementById('backgroundColorInput'),
    backgroundHexInput: document.getElementById('backgroundHexInput'),
    showOuterMaskInput: document.getElementById('showOuterMask'),
    exposureInput: document.getElementById('exposureInput'),
    contrastInput: document.getElementById('contrastInput'),
    hueInput: document.getElementById('hueInput'),
    saturationInput: document.getElementById('saturationInput'),
    exposureValue: document.getElementById('exposureValue'),
    contrastValue: document.getElementById('contrastValue'),
    hueValue: document.getElementById('hueValue'),
    saturationValue: document.getElementById('saturationValue'),
    resetAdjustmentsBtn: document.getElementById('resetAdjustmentsBtn'),
    ditherEnabledInput: document.getElementById('ditherEnabled'),
    previewModeToggle: document.getElementById('previewModeToggle'),
    previewModeActualBtn: document.getElementById('previewModeActualBtn'),
    previewModeFitBtn: document.getElementById('previewModeFitBtn'),
    paletteSelect: document.getElementById('paletteSelect'),
    floatingPreview: document.getElementById('floatingPreview'),
    previewCanvas: document.getElementById('previewCanvas'),
    cropFramePreview: document.getElementById('cropFramePreview'),
    cropFrame: document.getElementById('cropFrame'),
    cropFrameLabel: document.getElementById('cropFrameLabel'),
    maskTop: document.getElementById('maskTop'),
    maskRight: document.getElementById('maskRight'),
    maskBottom: document.getElementById('maskBottom'),
    maskLeft: document.getElementById('maskLeft')
};

export const state = {
    presetConfigs: [],
    activePresetId: null,
    cropper: null,
    originalImageURL: '',
    currentRotation: 0,
    scaleX: 1,
    scaleY: 1,
    targetWidth: 0,
    targetHeight: 0,
    resizeTimer: null,
    previewRenderTimer: null,
    previewDragState: null,
    previewPosition: { left: 18, top: 18 },
    previewMode: 'fit',
    showOuterMask: true,
    isColorPicking: false,
    suppressDitherPreview: false,
    isSpacePressed: false,
    workspacePanState: null,
    workspacePanOffset: { x: 0, y: 0 },
    sidePanelDragState: null,
    sidePanelPosition: null,
    historyStack: [],
    historyIndex: -1,
    isApplyingHistory: false,
    snapState: {
        horizontal: null,
        vertical: null
    },
    isApplyingWeakSnap: false,
    adjustmentState: {
        exposure: 0,
        contrast: 0,
        hue: 0,
        saturation: 0
    }
};

export const constants = {
    WEAK_SNAP_THRESHOLD: 6,
    WEAK_SNAP_RELEASE_THRESHOLD: 6,
    PRESET_CUSTOM_VALUE: 'custom',
    PRESET_MANAGE_VALUE: '__manage_presets__',
    PRESET_STORAGE_KEY: 'quickshakepic.presets.v1',
    USER_SETTINGS_STORAGE_KEY: 'quickshakepic.settings.v1'
};

export function appendFloatingPreviewToBody() {
    if (refs.floatingPreview.parentElement !== document.body) {
        document.body.appendChild(refs.floatingPreview);
    }
}

export function clearSnapState() {
    state.snapState.horizontal = null;
    state.snapState.vertical = null;
}

export function resetTransformState() {
    state.currentRotation = 0;
    state.scaleX = 1;
    state.scaleY = 1;
    clearSnapState();
}

export function destroyCropper() {
    if (state.cropper) {
        state.cropper.destroy();
        state.cropper = null;
    }
}

export function revokeOriginalImageURL() {
    if (state.originalImageURL) {
        URL.revokeObjectURL(state.originalImageURL);
        state.originalImageURL = '';
    }
}



