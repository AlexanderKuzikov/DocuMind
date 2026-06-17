const state = {
  docTypes: [],
  prompts: [],
  components: [],
  selectedDocType: null,
  selectedPrompt: null
};

const $ = (selector) => document.querySelector(selector);

function setStatus(text, isError = false) {
  const status = $('#status');
  status.textContent = text;
  status.classList.toggle('error', isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
  document.querySelectorAll('.tabs button').forEach((button) => button.classList.remove('active'));
  $(`#tab-${name}`).classList.add('active');
  $(`.tabs button[data-tab="${name}"]`).classList.add('active');
}

function prettyJson(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function renderStatus(result) {
  return `<span class="badge">${result.ok ? 'ok' : 'error'}</span>`;
}

async function loadConfig() {
  const result = await api('/api/config');
  $('#config-editor').value = result.content;
  setStatus('Config loaded');
}

async function saveConfig() {
  await api('/api/config', {
    method: 'PUT',
    body: JSON.stringify({ content: $('#config-editor').value })
  });
  setStatus('Config saved');
}

async function loadPipeline() {
  const result = await api('/api/components');
  state.components = result.available;
  renderPipeline(result.pipeline, result.available);
  setStatus('Pipeline loaded');
}

function renderPipeline(pipeline, available) {
  const byId = new Map(available.map((item) => [item.id, item]));
  $('#pipeline-list').innerHTML = '';

  if (!pipeline.length) {
    $('#pipeline-list').innerHTML = '<div class="card"><header><h2>No pipeline steps</h2></header></div>';
    return;
  }

  pipeline.forEach((step, index) => {
    const component = byId.get(step.component);
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <header>
        <h2>${index + 1}. ${escapeHtml(step.id || step.component)}</h2>
      </header>
      <p><b>component:</b> ${escapeHtml(step.component)} ${component ? renderStatus({ ok: true }) : '<span class="badge error">missing</span>'}</p>
      <p>${component ? escapeHtml(component.description || '') : 'Component file was not found.'}</p>
      <p>${component ? `<b>input:</b> ${escapeHtml((component.input || []).join(', ') || '—')}<br><b>output:</b> ${escapeHtml((component.output || []).join(', ') || '—')}` : ''}</p>
      <label><input type="checkbox" data-pipeline-field="enabled" data-index="${index}" ${step.enabled ? 'checked' : ''}> Enabled</label>
      <label><input type="checkbox" data-pipeline-field="required" data-index="${index}" ${step.required ? 'checked' : ''}> Required</label>
      <button data-pipeline-action="up" data-index="${index}" ${index === 0 ? 'disabled' : ''}>Move up</button>
      <button data-pipeline-action="down" data-index="${index}" ${index === pipeline.length - 1 ? 'disabled' : ''}>Move down</button>
      <button data-pipeline-action="remove" data-index="${index}">Remove</button>
    `;
    $('#pipeline-list').appendChild(card);
  });

  const availableNotInPipeline = available.filter((component) => !pipeline.some((step) => step.component === component.id));
  if (availableNotInPipeline.length) {
    const addCard = document.createElement('div');
    addCard.className = 'card';
    addCard.innerHTML = `
      <header><h2>Available but not in pipeline</h2></header>
      <p>These components export meta and can be added without changing UI code.</p>
      ${availableNotInPipeline.map((component) => `
        <button data-add-component="${escapeHtml(component.id)}">Add ${escapeHtml(component.label || component.id)}</button>
      `).join('')}
    `;
    $('#pipeline-list').appendChild(addCard);
  }
}

async function savePipeline() {
  const values = Array.from(document.querySelectorAll('[data-pipeline-field]')).reduce((map, input) => {
    const index = Number(input.dataset.index);
    map[index] = map[index] || {};
    map[index][input.dataset.field] = input.checked;
    return map;
  }, {});

  const pipeline = state.pipeline.map((step, index) => ({
    ...step,
    ...(values[index] || {})
  }));

  await api('/api/pipeline', {
    method: 'PUT',
    body: JSON.stringify({ pipeline })
  });
  setStatus('Pipeline saved');
  await loadPipeline();
}

function movePipelineStep(index, direction) {
  const next = [...state.pipeline];
  const target = index + direction;
  if (target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target], next[index]];
  state.pipeline = next;
  renderPipeline(next, state.components);
}

function removePipelineStep(index) {
  state.pipeline = state.pipeline.filter((_, itemIndex) => itemIndex !== index);
  renderPipeline(state.pipeline, state.components);
}

async function addComponent(id) {
  state.pipeline.push({
    id: id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
    component: id,
    enabled: true,
    required: false
  });
  renderPipeline(state.pipeline, state.components);
}

async function loadDocTypes() {
  const result = await api('/api/doc-types');
  state.docTypes = result.items;
  renderDocTypeList();
  setStatus('Doc types loaded');
}

function renderDocTypeList() {
  $('#doc-type-list').innerHTML = state.docTypes.map((item) => `
    <button class="${item.name === state.selectedDocType?.name ? 'active' : ''}" data-doc-type="${escapeHtml(item.name)}">
      ${escapeHtml(item.name)}
    </button>
  `).join('');
}

function selectDocType(name) {
  state.selectedDocType = state.docTypes.find((item) => item.name === name);
  $('#doc-type-title').textContent = state.selectedDocType?.name || 'Select doc type';
  $('#doc-type-editor').value = state.selectedDocType?.content || '';
  renderDocTypeList();
}

async function saveDocType() {
  if (!state.selectedDocType) return;
  await api(`/api/doc-types/${encodeURIComponent(state.selectedDocType.name)}`, {
    method: 'PUT',
    body: JSON.stringify({ content: $('#doc-type-editor').value })
  });
  setStatus(`Doc type ${state.selectedDocType.name} saved`);
}

async function loadPrompts() {
  const result = await api('/api/prompts');
  state.prompts = result.items;
  renderPromptList();
  setStatus('Prompts loaded');
}

function renderPromptList() {
  $('#prompt-list').innerHTML = state.prompts.map((item) => `
    <button class="${item.name === state.selectedPrompt?.name ? 'active' : ''}" data-prompt="${escapeHtml(item.name)}">
      ${escapeHtml(item.name)}
    </button>
  `).join('');
}

function selectPrompt(name) {
  state.selectedPrompt = state.prompts.find((item) => item.name === name);
  $('#prompt-title').textContent = state.selectedPrompt?.name || 'Select prompt';
  $('#prompt-editor').value = state.selectedPrompt?.content || '';
  renderPromptList();
}

async function savePrompt() {
  if (!state.selectedPrompt) return;
  await api(`/api/prompts/${encodeURIComponent(state.selectedPrompt.name)}`, {
    method: 'PUT',
    body: JSON.stringify({ content: $('#prompt-editor').value })
  });
  setStatus(`Prompt ${state.selectedPrompt.name} saved`);
}

async function runAction(action) {
  const output = $('#run-output');
  output.textContent = 'running…';
  try {
    let result;
    if (action === 'config-doctor') {
      result = await api('/api/actions/config-doctor', { method: 'POST' });
    } else if (action === 'dry-run') {
      result = await api('/api/actions/dry-run', { method: 'POST' });
    } else if (action === 'render-prompt') {
      result = await api('/api/actions/render-prompt', {
        method: 'POST',
        body: JSON.stringify({ docType: $('#render-doc-type').value })
      });
    } else if (action === 'extract') {
      result = await api('/api/actions/extract', { method: 'POST' });
    }
    output.textContent = prettyJson(result);
    setStatus(`${action} done`);
  } catch (error) {
    output.textContent = error.stack || error.message;
    setStatus(error.message, true);
  }
}

async function listFiles(type) {
  const result = await api(`/api/files/${type}`);
  $('#file-list').innerHTML = result.files.map((file) => `
    <button data-file="${escapeHtml(file.path)}" class="${file.directory ? 'directory' : ''}">
      ${file.directory ? '📁' : '📄'} ${escapeHtml(file.name)}
    </button>
  `).join('');
  $('#file-preview').textContent = prettyJson(result);
}

async function openFile(filePath) {
  const text = await fetch(`/api/files/${filePath}`).then((response) => response.text());
  $('#file-preview').textContent = text;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    showTab(tab.dataset.tab);
    return;
  }

  const action = event.target.closest('[data-action]');
  if (action) {
    const name = action.dataset.action;
    if (name === 'load-config') return loadConfig();
    if (name === 'save-config') return saveConfig();
    if (name === 'config-doctor') return runAction('config-doctor');
    if (name === 'load-pipeline') return loadPipeline();
    if (name === 'save-pipeline') return savePipeline();
    if (name === 'load-doc-types') return loadDocTypes();
    if (name === 'save-doc-type') return saveDocType();
    if (name === 'load-prompts') return loadPrompts();
    if (name === 'save-prompt') return savePrompt();
    if (name === 'dry-run') return runAction('dry-run');
    if (name === 'render-prompt') return runAction('render-prompt');
    if (name === 'extract') return runAction('extract');
    if (name === 'list-output') return listFiles('output');
    if (name === 'list-debug') return listFiles('debug');
  }

  const pipelineAction = event.target.closest('[data-pipeline-action]');
  if (pipelineAction) {
    const index = Number(pipelineAction.dataset.index);
    if (pipelineAction.dataset.action === 'up') movePipelineStep(index, -1);
    if (pipelineAction.dataset.action === 'down') movePipelineStep(index, 1);
    if (pipelineAction.dataset.action === 'remove') removePipelineStep(index);
  }

  const addComponent = event.target.closest('[data-add-component]');
  if (addComponent) await addComponent(addComponent.dataset.addComponent);

  const docType = event.target.closest('[data-doc-type]');
  if (docType) selectDocType(docType.dataset.docType);

  const prompt = event.target.closest('[data-prompt]');
  if (prompt) selectPrompt(prompt.dataset.prompt);

  const file = event.target.closest('[data-file]');
  if (file) await openFile(file.dataset.file);
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('[data-pipeline-field]')) {
    const index = Number(event.target.dataset.index);
    state.pipeline[index] = state.pipeline[index] || {};
    state.pipeline[index][event.target.dataset.field] = event.target.checked;
  }
});

state.pipeline = [];

async function init() {
  try {
    await loadConfig();
    await loadPipeline();
    await loadDocTypes();
    await loadPrompts();
    showTab('config');
    setStatus('Ready');
  } catch (error) {
    console.error(error);
    const message = error?.message || String(error);
    setStatus(`UI не загрузился: ${message}. Проверь, что открыт адрес из npm run ui, а не file://`, true);
  }
}

init();
