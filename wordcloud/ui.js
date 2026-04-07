import { PALETTES } from './palettes.js';
import { DATASETS, DATASET_META, LOG_DATASETS } from './datasets.js';
import { WordCloud, textToWords } from './wordcloud.js';

// --- DOM References ---
const container = document.getElementById('cloud-container');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const datasetSelect = document.getElementById('dataset-select');
const fontPickerBtn = document.getElementById('font-picker-btn');
const fontPickerMenu = document.getElementById('font-picker-menu');
const fontPickerLabel = document.getElementById('font-picker-label');
const fontItems = fontPickerMenu.querySelectorAll('.font-picker-item');
const colorPickerBtn = document.getElementById('color-picker-btn');
const colorPickerMenu = document.getElementById('color-picker-menu');
const colorPickerLabel = document.getElementById('color-picker-label');
const textOverlay = document.getElementById('text-input-overlay');
const textInput = document.getElementById('text-input');
const cancelBtn = document.getElementById('cancel-text-btn');
const generateBtn = document.getElementById('generate-btn');
const regenerateBtn = document.getElementById('regenerate-btn');
const paddingSlider = document.getElementById('padding-slider');
const paddingDots = paddingSlider.querySelectorAll('.step-dot');
const paddingFill = paddingSlider.querySelector('.step-fill');
const dynamicBtn = document.getElementById('dynamic-spacing-btn');
const descLine1 = document.getElementById('desc-line1');
const descExtents = document.getElementById('desc-extents');
const sparkCanvas = document.getElementById('desc-sparkline');

// --- State ---
let selectedFont = 'DM Sans, sans-serif';
let selectedColorScheme = 'vibrant';
let wc = null;
let customWords = null;
let userChangedScaling = false;
let previewingColor = false;
let savedColors = null;

// --- Font Picker ---
fontPickerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fontPickerMenu.classList.toggle('open');
});

fontPickerMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.font-picker-item');
  if (!item) return;
  fontItems.forEach(i => i.classList.remove('selected'));
  item.classList.add('selected');
  selectedFont = item.dataset.value;
  fontPickerLabel.textContent = item.textContent;
  fontPickerBtn.style.fontFamily = item.style.fontFamily;
  fontPickerMenu.classList.remove('open');
  renderDataset(datasetSelect.value);
});

document.addEventListener('click', () => {
  fontPickerMenu.classList.remove('open');
  colorPickerMenu.classList.remove('open');
});

// --- Color Picker ---
function buildColorMenu() {
  colorPickerMenu.innerHTML = '';
  for (const [name, colors] of Object.entries(PALETTES)) {
    const item = document.createElement('div');
    item.className = 'font-picker-item' + (name === selectedColorScheme ? ' selected' : '');
    item.dataset.value = name;
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.gap = '6px';
    for (let i = 0; i < 5; i++) {
      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.background = colors[i];
      dot.style.width = '8px';
      dot.style.height = '8px';
      item.appendChild(dot);
    }
    const label = document.createElement('span');
    label.style.marginLeft = '4px';
    label.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    item.appendChild(label);
    colorPickerMenu.appendChild(item);
  }
}
buildColorMenu();

function updateColorLabel(name, colors) {
  colorPickerLabel.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.background = colors[i];
    colorPickerLabel.appendChild(dot);
  }
  colorPickerLabel.appendChild(document.createTextNode(' ' + name.charAt(0).toUpperCase() + name.slice(1)));
}

colorPickerBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fontPickerMenu.classList.remove('open');
  colorPickerMenu.classList.toggle('open');
});

function applyPaletteToCloud(name) {
  if (!wc || wc._placedWords.length === 0) return;
  const palette = PALETTES[name];
  if (!palette) return;
  wc._placedWords.forEach((w, i) => { w.color = palette[i % palette.length]; });
  wc._redrawAll();
}

colorPickerMenu.addEventListener('mouseover', (e) => {
  const item = e.target.closest('.font-picker-item');
  if (!item || !wc || wc._placedWords.length === 0) return;
  if (!previewingColor) {
    savedColors = wc._placedWords.map(w => w.color);
    previewingColor = true;
  }
  applyPaletteToCloud(item.dataset.value);
});

colorPickerMenu.addEventListener('mouseleave', () => {
  if (previewingColor && savedColors && wc && wc._placedWords.length > 0) {
    wc._placedWords.forEach((w, i) => { w.color = savedColors[i]; });
    wc._redrawAll();
    previewingColor = false;
    savedColors = null;
  }
});

colorPickerMenu.addEventListener('click', (e) => {
  const item = e.target.closest('.font-picker-item');
  if (!item) return;
  colorPickerMenu.querySelectorAll('.font-picker-item').forEach(i => i.classList.remove('selected'));
  item.classList.add('selected');
  selectedColorScheme = item.dataset.value;
  const palette = PALETTES[selectedColorScheme];
  updateColorLabel(selectedColorScheme, palette);
  colorPickerMenu.classList.remove('open');

  previewingColor = false;
  savedColors = null;
  applyPaletteToCloud(selectedColorScheme);
  if (wc) wc.options.colorScheme = selectedColorScheme;
});

// --- Chip Groups ---
function getChipValue(groupId) {
  const active = document.querySelector(`#${groupId} .active`);
  return active ? active.dataset.value : null;
}

function setChipValue(groupId, value) {
  document.querySelectorAll(`#${groupId} .chip, #${groupId} .color-chip`).forEach(c => {
    c.classList.toggle('active', c.dataset.value === value);
  });
}

['layout-chips', 'scaling-chips', 'rotation-chips'].forEach(groupId => {
  document.getElementById(groupId).addEventListener('click', (e) => {
    const chip = e.target.closest('[data-value]');
    if (!chip) return;
    document.querySelectorAll(`#${groupId} .chip, #${groupId} .color-chip`).forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    if (groupId === 'scaling-chips') userChangedScaling = true;
    renderDataset(datasetSelect.value);
  });
});

// --- Padding Slider ---
function updatePaddingSlider() {
  const dots = [...paddingDots];
  const activeIdx = dots.findIndex(d => d.classList.contains('active'));
  if (activeIdx >= 0 && dots.length > 1) {
    const sliderRect = paddingSlider.getBoundingClientRect();
    const firstRect = dots[0].getBoundingClientRect();
    const activeRect = dots[activeIdx].getBoundingClientRect();
    const start = firstRect.left + firstRect.width / 2 - sliderRect.left;
    const end = activeRect.left + activeRect.width / 2 - sliderRect.left;
    paddingFill.style.left = start + 'px';
    paddingFill.style.width = (end - start) + 'px';
  }
  dots.forEach((d, i) => {
    if (i < activeIdx) { d.className = 'step-dot past'; }
    else if (i === activeIdx) { d.className = 'step-dot active'; }
    else { d.className = 'step-dot'; }
  });
}

paddingSlider.addEventListener('click', (e) => {
  const dot = e.target.closest('.step-dot');
  if (!dot) return;
  paddingDots.forEach(d => d.classList.remove('active', 'past'));
  dot.classList.add('active');
  updatePaddingSlider();
  renderDataset(datasetSelect.value);
});

function getPaddingValue() {
  const active = paddingSlider.querySelector('.step-dot.active');
  return active ? parseInt(active.dataset.value) : 4;
}

// --- Dynamic Spacing ---
dynamicBtn.addEventListener('click', () => {
  dynamicBtn.classList.toggle('active');
  renderDataset(datasetSelect.value);
});

// --- Cloud Creation ---
function createCloud() {
  if (wc) wc.destroy();

  wc = new WordCloud(container, {
    fontFamily: selectedFont,
    layout: getChipValue('layout-chips'),
    scaling: getChipValue('scaling-chips'),
    colorScheme: selectedColorScheme,
    rotationProbability: parseFloat(getChipValue('rotation-chips')),
    padding: getPaddingValue(),
    dynamicSpacing: dynamicBtn.classList.contains('active'),
    showDebugPath: document.getElementById('debug-path-toggle').checked,
    backgroundColor: '#1a1a2e',
  });

  wc.on('wordPlaced', ({ progress }) => {
    statusEl.textContent = `Placing word ${progress.placed} of ${progress.total}...`;
    statusEl.className = 'active';
  });

  wc.on('complete', ({ stats }) => {
    statusEl.textContent = 'Layout complete';
    statusEl.className = '';
    statsEl.textContent = `${stats.placed} words placed in ${(stats.timeMs / 1000).toFixed(1)}s` +
      (stats.skipped > 0 ? ` (${stats.skipped} skipped)` : '');
  });

  wc.on('click', ({ word }) => {
    statusEl.textContent = `${word.text}`;
    statusEl.className = '';
  });
}

// --- Description Bar ---
function fmt(v, unit) {
  if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M' + unit;
  if (v >= 1000) return (v / 1000).toFixed(1) + 'K' + unit;
  if (v < 0.01) return v.toExponential(1) + unit;
  if (v < 1) return v.toFixed(2) + unit;
  return v.toLocaleString() + unit;
}

function drawSparkline(values) {
  const dpr = window.devicePixelRatio || 1;
  const rect = sparkCanvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  sparkCanvas.width = w * dpr;
  sparkCanvas.height = h * dpr;
  const ctx = sparkCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (values.length === 0) return;

  const max = values[0];
  const barW = Math.max(1, (w - 2) / values.length);
  const pad = 2;

  ctx.fillStyle = '#2a2a5a';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < values.length; i++) {
    const norm = values[i] / max;
    const barH = Math.max(1, norm * (h - pad * 2));
    const x = i * barW;
    const y = h - pad - barH;

    const t = norm;
    const r = Math.round(83 + t * (233 - 83));
    const g = Math.round(136 + t * (69 - 136));
    const b = Math.round(251 + t * (96 - 251));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, Math.max(1, barW - 0.5), barH);
  }
}

function updateDescription(id) {
  const meta = DATASET_META[id];
  if (!meta) {
    descLine1.innerHTML = '';
    descExtents.innerHTML = '';
    return;
  }
  const data = DATASETS[id];
  if (!data || data.length === 0) return;

  const sorted = data.slice().sort((a, b) => b.value - a.value);
  const max = sorted[0];
  const min = sorted[sorted.length - 1];

  descLine1.innerHTML =
    `<span class="desc-title">${meta.title}</span> · ${meta.desc} · ${data.length} words`;

  descExtents.innerHTML =
    `<span class="desc-metric">${meta.metric}</span>: ` +
    `${max.text} (${fmt(max.value, meta.unit)}) → ${min.text} (${fmt(min.value, meta.unit)})`;

  drawSparkline(sorted.map(d => d.value));
}

// --- Dataset Rendering ---
function renderDataset(id) {
  if (!userChangedScaling) {
    if (LOG_DATASETS.has(id)) {
      setChipValue('scaling-chips', 'log');
    } else {
      setChipValue('scaling-chips', 'linear');
    }
  }

  if (id === 'custom') {
    if (customWords) {
      createCloud();
      wc.render(customWords);
    } else {
      textOverlay.classList.add('visible');
    }
    return;
  }

  textOverlay.classList.remove('visible');
  updateDescription(id);
  createCloud();
  wc.render(DATASETS[id]);
}

// --- Event Wiring ---
datasetSelect.addEventListener('change', () => { userChangedScaling = false; renderDataset(datasetSelect.value); });
regenerateBtn.addEventListener('click', () => renderDataset(datasetSelect.value));
document.getElementById('debug-path-toggle').addEventListener('change', () => {
  if (wc) {
    wc.options.showDebugPath = document.getElementById('debug-path-toggle').checked;
    wc._redrawAll();
  }
});

cancelBtn.addEventListener('click', () => {
  textOverlay.classList.remove('visible');
  datasetSelect.value = 'lovecraft';
  renderDataset('lovecraft');
});

generateBtn.addEventListener('click', () => {
  const text = textInput.value.trim();
  if (!text) return;
  customWords = textToWords(text);
  textOverlay.classList.remove('visible');
  descLine1.innerHTML = `<span class="desc-title">Your Text</span> · Word frequencies from pasted text · ${customWords.length} unique words`;
  if (customWords.length > 0) {
    const cSorted = customWords.slice().sort((a, b) => b.value - a.value);
    descExtents.innerHTML = `<span class="desc-metric">occurrences</span>: ${cSorted[0].text} (${cSorted[0].value}) → ${cSorted[cSorted.length-1].text} (${cSorted[cSorted.length-1].value})`;
    drawSparkline(cSorted.map(d => d.value));
  }
  createCloud();
  wc.render(customWords);
});

// --- Initialization ---
const datasetKeys = Object.keys(DATASETS);
datasetSelect.value = datasetKeys[Math.floor(Math.random() * datasetKeys.length)];

const fontItemsArr = [...fontItems];
const randomFontItem = fontItemsArr[Math.floor(Math.random() * fontItemsArr.length)];
fontItems.forEach(i => i.classList.remove('selected'));
randomFontItem.classList.add('selected');
selectedFont = randomFontItem.dataset.value;
fontPickerLabel.textContent = randomFontItem.textContent;
fontPickerBtn.style.fontFamily = randomFontItem.style.fontFamily;

const paletteNames = Object.keys(PALETTES);
const randomPalette = paletteNames[Math.floor(Math.random() * paletteNames.length)];
selectedColorScheme = randomPalette;
updateColorLabel(randomPalette, PALETTES[randomPalette]);
colorPickerMenu.querySelectorAll('.font-picker-item').forEach(i => {
  i.classList.toggle('selected', i.dataset.value === randomPalette);
});

updatePaddingSlider();
renderDataset(datasetSelect.value);
