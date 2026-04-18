import { constants, refs, state } from './state.js?v=20260418-3';
import {
    setInputsFromDimensions,
    tryAutoApplyResolution,
    updateCustomSizeVisibility
} from './editor.js?v=20260418-3';

const DEFAULT_PRESET_CONFIGS = [
    { id: 'preset-200x200', name: '1.54"', width: 200, height: 200 },
    { id: 'preset-122x250', name: '2.13"', width: 122, height: 250 },
    { id: 'preset-152x296', name: '2.66"', width: 152, height: 296 },
    { id: 'preset-296x128', name: '2.9"', width: 296, height: 128 },
    { id: 'preset-184x384', name: '3.5"', width: 184, height: 384 },
    { id: 'preset-800x480-a', name: '3.97"', width: 800, height: 480 },
    { id: 'preset-400x300', name: '4.2"', width: 400, height: 300 },
    { id: 'preset-648x480', name: '5.8"', width: 648, height: 480 },
    { id: 'preset-800x480-b', name: '7.5"', width: 800, height: 480 },
    { id: 'preset-960x672', name: '9.7"', width: 960, height: 672 }
];

let presetDrafts = [];
let draggingDraftIndex = null;
let draggingDraftId = '';
let dragPreviewTarget = null;

function clonePreset(preset) {
    return {
        id: preset.id,
        name: preset.name,
        width: preset.width,
        height: preset.height
    };
}

function createPresetId() {
    return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePreset(rawPreset) {
    const width = Number.parseInt(rawPreset.width, 10);
    const height = Number.parseInt(rawPreset.height, 10);
    const name = String(rawPreset.name || '').trim();

    if (!name || !width || !height || width < 1 || height < 1) {
        return null;
    }

    return {
        id: String(rawPreset.id || createPresetId()),
        name,
        width,
        height
    };
}

function loadPresetConfigs() {
    try {
        const rawValue = localStorage.getItem(constants.PRESET_STORAGE_KEY);
        if (!rawValue) {
            return DEFAULT_PRESET_CONFIGS.map(clonePreset);
        }

        const parsed = JSON.parse(rawValue);
        if (!Array.isArray(parsed)) {
            return DEFAULT_PRESET_CONFIGS.map(clonePreset);
        }

        const normalized = parsed
            .map(normalizePreset)
            .filter(Boolean);

        return normalized.length ? normalized : DEFAULT_PRESET_CONFIGS.map(clonePreset);
    } catch (error) {
        return DEFAULT_PRESET_CONFIGS.map(clonePreset);
    }
}

function persistPresetConfigs() {
    localStorage.setItem(constants.PRESET_STORAGE_KEY, JSON.stringify(state.presetConfigs));
}

function getPresetLabel(preset) {
    return `${preset.name} (${preset.width} × ${preset.height})`;
}

function createRowMarkup(draft, index) {
    const name = escapeHtml(draft.name);
    const width = draft.width ? String(draft.width) : '';
    const height = draft.height ? String(draft.height) : '';

    return `
        <div class="preset-row" data-index="${index}">
            <span class="preset-drag-handle" title="拖动排序" aria-label="拖动排序" draggable="true">⋮⋮</span>
            <input class="preset-cell-input" type="text" data-field="name" value="${name}" placeholder="名称">
            <input class="preset-cell-input" type="number" data-field="width" value="${width}" min="1" max="10000" placeholder="宽度">
            <input class="preset-cell-input" type="number" data-field="height" value="${height}" min="1" max="10000" placeholder="高度">
            <div class="preset-row-actions">
                <button class="preset-action-btn preset-save-btn" type="button" data-action="save" title="保存" aria-label="保存">✓</button>
                <button class="preset-action-btn preset-delete-btn" type="button" data-action="delete" title="删除" aria-label="删除">✕</button>
            </div>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isDraftDirty(draft) {
    return draft.isNew
        || draft.name !== draft.originalName
        || String(draft.width) !== String(draft.originalWidth)
        || String(draft.height) !== String(draft.originalHeight);
}

function isDraftValid(draft) {
    return Boolean(normalizePreset(draft));
}

function refreshRowButtonStates() {
    refs.presetManagerRows.querySelectorAll('.preset-row').forEach((rowElement) => {
        const rowIndex = Number.parseInt(rowElement.dataset.index, 10);
        const draft = presetDrafts[rowIndex];
        const saveButton = rowElement.querySelector('[data-action="save"]');
        const canSave = Boolean(draft) && isDraftDirty(draft) && isDraftValid(draft);
        saveButton.disabled = !canSave;
    });
}

function renderPresetManagerRows() {
    refs.presetManagerRows.innerHTML = presetDrafts.map(createRowMarkup).join('');
    if (dragPreviewTarget) {
        const targetRow = refs.presetManagerRows.querySelector(`.preset-row[data-index="${dragPreviewTarget.index}"]`);
        if (targetRow) {
            targetRow.classList.add(dragPreviewTarget.position === 'before' ? 'insert-before' : 'insert-after');
        }
    }
    refreshRowButtonStates();
}

function resetDrafts() {
    presetDrafts = state.presetConfigs.map((preset) => ({
        ...clonePreset(preset),
        originalName: preset.name,
        originalWidth: preset.width,
        originalHeight: preset.height,
        isNew: false
    }));
}

function closePresetManager() {
    refs.presetManagerModal.hidden = true;
    document.body.style.overflow = '';
}

export function getPresetById(presetId) {
    return state.presetConfigs.find((preset) => preset.id === presetId) || null;
}

export function findMatchingPreset(width, height) {
    return state.presetConfigs.find((preset) => preset.width === width && preset.height === height) || null;
}

export function renderPresetOptions(selectedValue = '') {
    const optionsMarkup = state.presetConfigs
        .map((preset) => `<option value="${preset.id}">${escapeHtml(getPresetLabel(preset))}</option>`)
        .join('');

    refs.presetSizeSelect.innerHTML = `
        <option value="" hidden>手动输入尺寸</option>
        ${optionsMarkup}
        <option value="${constants.PRESET_MANAGE_VALUE}">预设尺寸管理</option>`;

    const hasMatchedPreset = Boolean(selectedValue) && state.presetConfigs.some((preset) => preset.id === selectedValue);
    refs.presetSizeSelect.value = hasMatchedPreset ? selectedValue : '';
}

export function selectCustomPreset() {
    state.activePresetId = null;
    refs.presetSizeSelect.value = '';
    updateCustomSizeVisibility();
}

export function applyPresetSelection(presetId) {
    const preset = getPresetById(presetId);
    if (!preset) {
        return false;
    }

    state.activePresetId = preset.id;
    refs.presetSizeSelect.value = preset.id;
    setInputsFromDimensions(preset.width, preset.height);
    updateCustomSizeVisibility();
    tryAutoApplyResolution();
    return true;
}

function saveDraftAtIndex(index) {
    const draft = presetDrafts[index];
    const normalized = normalizePreset(draft);

    if (!draft || !normalized) {
        return;
    }

    const nextPreset = clonePreset(normalized);
    const existingIndex = state.presetConfigs.findIndex((preset) => preset.id === draft.id);

    if (existingIndex >= 0) {
        state.presetConfigs[existingIndex] = nextPreset;
    } else {
        state.presetConfigs.push(nextPreset);
    }

    persistPresetConfigs();
    resetDrafts();

    const currentWidth = Number.parseInt(refs.widthInput.value, 10);
    const currentHeight = Number.parseInt(refs.heightInput.value, 10);

    if (state.activePresetId === nextPreset.id) {
        setInputsFromDimensions(nextPreset.width, nextPreset.height);
        tryAutoApplyResolution();
    } else {
        const matchedPreset = findMatchingPreset(currentWidth, currentHeight);
        state.activePresetId = matchedPreset ? matchedPreset.id : null;
    }

    renderPresetOptions(state.activePresetId || '');
    renderPresetManagerRows();
    updateCustomSizeVisibility();
}

function deleteDraftAtIndex(index) {
    const draft = presetDrafts[index];
    if (!draft) {
        return;
    }

    if (draft.isNew) {
        presetDrafts.splice(index, 1);
        renderPresetManagerRows();
        return;
    }

    state.presetConfigs = state.presetConfigs.filter((preset) => preset.id !== draft.id);
    persistPresetConfigs();

    if (state.activePresetId === draft.id) {
        state.activePresetId = null;
    }

    resetDrafts();

    const currentWidth = Number.parseInt(refs.widthInput.value, 10);
    const currentHeight = Number.parseInt(refs.heightInput.value, 10);
    const matchedPreset = findMatchingPreset(currentWidth, currentHeight);

    state.activePresetId = matchedPreset ? matchedPreset.id : null;
    renderPresetOptions(state.activePresetId || '');
    updateCustomSizeVisibility();
    renderPresetManagerRows();
}

function moveDraft(fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
        return;
    }
    if (fromIndex >= presetDrafts.length || toIndex >= presetDrafts.length) {
        return;
    }

    const [moved] = presetDrafts.splice(fromIndex, 1);
    presetDrafts.splice(toIndex, 0, moved);
}

function persistDraftOrder() {
    const normalizedDrafts = presetDrafts
        .map(normalizePreset)
        .filter(Boolean);
    const validDraftIdSet = new Set(normalizedDrafts.map((draft) => draft.id));
    const orphanPresets = state.presetConfigs.filter((preset) => !validDraftIdSet.has(preset.id));
    state.presetConfigs = [...normalizedDrafts, ...orphanPresets];
    persistPresetConfigs();
}

function findDraftIndexById(draftId) {
    return presetDrafts.findIndex((draft) => draft.id === draftId);
}

function clearInsertMarkers() {
    refs.presetManagerRows.querySelectorAll('.preset-row.insert-before, .preset-row.insert-after')
        .forEach((row) => row.classList.remove('insert-before', 'insert-after'));
}

function handleDraftInput(event) {
    const rowElement = event.target.closest('.preset-row');
    if (!rowElement) {
        return;
    }

    const rowIndex = Number.parseInt(rowElement.dataset.index, 10);
    const draft = presetDrafts[rowIndex];
    const fieldName = event.target.dataset.field;

    if (!draft || !fieldName) {
        return;
    }

    if (fieldName === 'name') {
        draft.name = event.target.value;
    } else {
        draft[fieldName] = event.target.value;
    }

    refreshRowButtonStates();
}

function handleDraftAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) {
        return;
    }

    const rowElement = button.closest('.preset-row');
    if (!rowElement) {
        return;
    }

    const rowIndex = Number.parseInt(rowElement.dataset.index, 10);
    const action = button.dataset.action;

    if (action === 'save') {
        saveDraftAtIndex(rowIndex);
        return;
    }

    if (action === 'delete') {
        deleteDraftAtIndex(rowIndex);
    }
}

function handleRowDragStart(event) {
    const handleElement = event.target.closest('.preset-drag-handle');
    if (!handleElement) {
        return;
    }
    const rowElement = handleElement.closest('.preset-row');
    if (!rowElement) {
        return;
    }

    const rowIndex = Number.parseInt(rowElement.dataset.index, 10);
    if (Number.isNaN(rowIndex)) {
        return;
    }

    draggingDraftIndex = rowIndex;
    draggingDraftId = presetDrafts[rowIndex]?.id || '';
    dragPreviewTarget = null;
    rowElement.classList.add('is-dragging');

    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(rowIndex));
    }
}

function handleRowDragOver(event) {
    if (!draggingDraftId) {
        return;
    }

    const rowElement = event.target.closest('.preset-row');
    if (!rowElement) {
        return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
    }

    const targetIndex = Number.parseInt(rowElement.dataset.index, 10);
    if (Number.isNaN(targetIndex)) {
        return;
    }

    const sourceIndex = findDraftIndexById(draggingDraftId);
    if (sourceIndex < 0) {
        return;
    }

    const rect = rowElement.getBoundingClientRect();
    const shouldInsertAfter = event.clientY > rect.top + rect.height / 2;
    const targetPosition = shouldInsertAfter ? 'after' : 'before';
    const previewTarget = { index: targetIndex, position: targetPosition };

    if (dragPreviewTarget &&
        dragPreviewTarget.index === previewTarget.index &&
        dragPreviewTarget.position === previewTarget.position) {
        return;
    }

    let insertIndex = targetIndex + (shouldInsertAfter ? 1 : 0);
    if (sourceIndex < insertIndex) {
        insertIndex -= 1;
    }

    if (insertIndex !== sourceIndex) {
        moveDraft(sourceIndex, insertIndex);
        draggingDraftIndex = insertIndex;
        renderPresetManagerRows();
    } else {
        clearInsertMarkers();
    }

    dragPreviewTarget = previewTarget;
    const previewRow = refs.presetManagerRows.querySelector(`.preset-row[data-index="${targetIndex}"]`);
    if (previewRow) {
        previewRow.classList.add(shouldInsertAfter ? 'insert-after' : 'insert-before');
    }
}

function handleRowDrop(event) {
    if (!draggingDraftId) {
        return;
    }

    event.preventDefault();
    persistDraftOrder();
    draggingDraftIndex = null;
    draggingDraftId = '';
    dragPreviewTarget = null;
    clearInsertMarkers();
    renderPresetManagerRows();
    renderPresetOptions(state.activePresetId || '');
}

function handleRowDragEnd() {
    draggingDraftIndex = null;
    draggingDraftId = '';
    dragPreviewTarget = null;
    clearInsertMarkers();
    refs.presetManagerRows.querySelectorAll('.preset-row.is-dragging')
        .forEach((row) => row.classList.remove('is-dragging'));
}

export function openPresetManager() {
    resetDrafts();
    renderPresetManagerRows();
    refs.presetManagerModal.hidden = false;
    document.body.style.overflow = 'hidden';
}

function addPresetDraft() {
    presetDrafts.unshift({
        id: createPresetId(),
        name: '',
        width: '',
        height: '',
        originalName: '',
        originalWidth: '',
        originalHeight: '',
        isNew: true
    });
    renderPresetManagerRows();
}

export function initializePresetManager() {
    state.presetConfigs = loadPresetConfigs();
    const initialPreset = state.presetConfigs[0] || null;

    renderPresetOptions(initialPreset ? initialPreset.id : '');

    if (initialPreset) {
        state.activePresetId = initialPreset.id;
        setInputsFromDimensions(initialPreset.width, initialPreset.height);
    } else {
        state.activePresetId = null;
        setInputsFromDimensions('', '');
    }

    refs.closePresetManagerBtn.addEventListener('click', closePresetManager);
    refs.addPresetBtn.addEventListener('click', addPresetDraft);
    refs.presetManagerRows.addEventListener('input', handleDraftInput);
    refs.presetManagerRows.addEventListener('click', handleDraftAction);
    refs.presetManagerRows.addEventListener('dragstart', handleRowDragStart);
    refs.presetManagerRows.addEventListener('dragover', handleRowDragOver);
    refs.presetManagerRows.addEventListener('drop', handleRowDrop);
    refs.presetManagerRows.addEventListener('dragend', handleRowDragEnd);

    refs.presetManagerModal.addEventListener('click', (event) => {
        if (event.target === refs.presetManagerModal) {
            closePresetManager();
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !refs.presetManagerModal.hidden) {
            closePresetManager();
        }
    });
}
