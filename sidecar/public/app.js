// Tela inicial do Bull Monitor: lista os servidores Redis e mostra um resumo leve de cada um.
// Sem framework, de propósito: a página fica aberta o tempo todo e precisa gastar pouco.

const REFRESH_MS = 15_000;

const grid = document.getElementById('servers');
const empty = document.getElementById('empty');
const template = document.getElementById('card-template');
const dialog = document.getElementById('server-dialog');
const form = document.getElementById('server-form');
const testResult = document.getElementById('test-result');

let servers = [];

translatePage();
translatePage(template.content);

// ---------- idioma ----------

// Lista própria em vez de <select>, para ter o mesmo visual do seletor de idioma do bull-board (a
// lista aberta de um <select> nativo não aceita estilo). Segue o padrão listbox da WAI-ARIA.
const languageTrigger = document.getElementById('language');
const languageList = document.getElementById('language-list');
const CHECK_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>';

languageTrigger.querySelector('.lang-value').textContent = LANG;
languageTrigger.setAttribute('aria-label', `${t('language')}: ${LANGUAGE_NAMES[LANG]}`);

const languageOptions = Object.entries(LANGUAGE_NAMES).map(([code, name]) => {
  const option = document.createElement('li');
  option.id = `language-${code}`;
  option.setAttribute('role', 'option');
  option.dataset.code = code;
  option.title = name;
  option.setAttribute('aria-selected', String(code === LANG));
  option.innerHTML = CHECK_ICON;
  option.append(code);
  option.onpointermove = () => highlightLanguage(option);
  option.onclick = () => chooseLanguage(code);
  return option;
});
languageList.append(...languageOptions);

let highlightedLanguage;

function highlightLanguage(option) {
  highlightedLanguage?.classList.remove('highlighted');
  highlightedLanguage = option;
  option.classList.add('highlighted');
  option.scrollIntoView({ block: 'nearest' });
  languageList.setAttribute('aria-activedescendant', option.id);
}

function openLanguages() {
  languageList.hidden = false;
  languageTrigger.setAttribute('aria-expanded', 'true');
  highlightLanguage(languageOptions.find((option) => option.dataset.code === LANG));
  languageList.focus();
}

function closeLanguages({ focusTrigger = true } = {}) {
  if (languageList.hidden) return;
  languageList.hidden = true;
  languageTrigger.setAttribute('aria-expanded', 'false');
  if (focusTrigger) languageTrigger.focus();
}

// Salva no sidecar e recarrega: a página e as mensagens do servidor passam a vir no idioma novo.
async function chooseLanguage(code) {
  closeLanguages();
  if (code === LANG) return;
  try {
    await api('/api/settings', { method: 'PUT', body: JSON.stringify({ language: code }) });
    location.reload();
  } catch (error) {
    alert(error.message);
  }
}

languageTrigger.onclick = () => (languageList.hidden ? openLanguages() : closeLanguages());
languageTrigger.onkeydown = (event) => {
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    openLanguages();
  }
};

languageList.onkeydown = (event) => {
  const index = languageOptions.indexOf(highlightedLanguage);
  const move = {
    ArrowDown: Math.min(index + 1, languageOptions.length - 1),
    ArrowUp: Math.max(index - 1, 0),
    Home: 0,
    End: languageOptions.length - 1,
  }[event.key];
  if (move !== undefined) {
    event.preventDefault();
    highlightLanguage(languageOptions[move]);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    chooseLanguage(highlightedLanguage.dataset.code);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeLanguages();
  } else if (event.key === 'Tab') {
    closeLanguages({ focusTrigger: false });
  }
};

// Clique fora fecha, como no bull-board.
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.lang-select')) closeLanguages({ focusTrigger: false });
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || t('error', { status: response.status }));
  return body;
}

const formatNumber = (n) => new Intl.NumberFormat(LANG).format(n);

function render() {
  empty.hidden = servers.length > 0;
  grid.replaceChildren(
    ...servers.map((server) => {
      const card = template.content.firstElementChild.cloneNode(true);
      card.dataset.id = server.id;
      card.dataset.status = 'loading';
      card.querySelector('.name').textContent = server.name;
      card.querySelector('.url').textContent = server.url;
      card.querySelector('.url').title = server.url;
      card.querySelector('.readonly').hidden = !server.readOnly;
      const open = card.querySelector('.open');
      open.href = `/s/${server.id}/`;
      open.onclick = (event) => {
        event.preventDefault();
        openServer(server);
      };
      card.querySelector('.edit').onclick = () => openDialog(server);
      card.querySelector('.remove').onclick = () => removeServer(server);
      card.querySelector('.rescan').onclick = (event) => rescan(server, event.currentTarget);
      return card;
    })
  );
}

function paintSummary(card, summary) {
  card.dataset.status = summary.status;
  for (const dd of card.querySelectorAll('dd[data-k]')) {
    dd.textContent = summary.status === 'online' ? formatNumber(summary[dd.dataset.k]) : '–';
  }
  card.querySelector('dd[data-k="failed"]').classList.toggle('has', summary.failed > 0);
  const error = card.querySelector('.error');
  error.hidden = !summary.error;
  error.textContent = summary.error ?? '';
}

/** Cada servidor é consultado em paralelo, assim um Redis lento não atrasa os outros. */
function refreshSummaries() {
  for (const card of grid.querySelectorAll('.card')) {
    api(`/api/servers/${card.dataset.id}/summary`)
      .then((summary) => paintSummary(card, summary))
      .catch((error) => paintSummary(card, { status: 'offline', error: error.message }));
  }
}

async function loadServers() {
  servers = await api('/api/servers');
  render();
  refreshSummaries();
}

async function rescan(server, button) {
  button.disabled = true;
  try {
    await api(`/api/servers/${server.id}/refresh`, { method: 'POST' });
    refreshSummaries();
  } catch (error) {
    alert(t('rescanFailed', { error: error.message }));
  } finally {
    button.disabled = false;
  }
}

async function removeServer(server) {
  if (!confirm(t('confirmRemove', { name: server.name }))) return;
  await api(`/api/servers/${server.id}`, { method: 'DELETE' });
  await loadServers();
}

// ---------- abrir board ----------

// Navegar direto para a board deixaria a janela parada enquanto o servidor procura as filas.
// Em vez disso, abre pela API mostrando o carregamento e só navega quando a board estiver pronta.
const openingDialog = document.getElementById('opening-dialog');
const openingText = document.getElementById('opening-text');
let opening;

async function openServer(server) {
  const controller = new AbortController();
  opening = { server, controller };
  openingText.textContent = t('opening', { name: server.name });
  openingDialog.showModal();
  try {
    await api(`/api/servers/${server.id}/open`, { method: 'POST', signal: controller.signal });
    opening = undefined;
    location.href = `/s/${server.id}/`;
  } catch (error) {
    if (controller.signal.aborted) return;
    opening = undefined;
    openingDialog.close();
    alert(t('openFailed', { name: server.name, error: error.message }));
  }
}

function cancelOpening() {
  if (!opening) return;
  const { server, controller } = opening;
  opening = undefined;
  controller.abort();
  // Sem isso a abertura terminaria no servidor e deixaria a conexão aberta.
  api(`/api/servers/${server.id}/close`, { method: 'POST' }).catch(() => {});
  openingDialog.close();
}

document.getElementById('opening-cancel').onclick = cancelOpening;
// Esc fecha o diálogo por conta própria; trata como cancelar.
openingDialog.addEventListener('cancel', cancelOpening);

// ---------- formulário ----------

// O servidor devolve a senha salva como este marcador; mandá-lo de volta mantém a senha atual.
const PASSWORD_MASK = '****';

let mode = 'fields';

function setMode(next) {
  // Leva o que já foi digitado para o outro modo, para a troca não apagar nada.
  try {
    if (next === 'url' && mode === 'fields') form.elements.url.value = urlFromFields();
    if (next === 'fields' && mode === 'url') fillFields(form.elements.url.value);
  } catch {
    // Campos incompletos ou URL inválida: troca de modo sem converter.
  }
  mode = next;
  form.querySelector('.mode-fields').hidden = mode !== 'fields';
  form.querySelector('.mode-url').hidden = mode !== 'url';
  for (const button of form.querySelectorAll('.segmented button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
}

for (const button of form.querySelectorAll('.segmented button')) {
  button.onclick = () => setMode(button.dataset.mode);
}

/** Monta a URL do Redis a partir dos campos. O objeto URL cuida de codificar a senha. */
function urlFromFields() {
  const f = form.elements;
  let host = f.host.value.trim();
  if (!host) throw new Error(t('hostRequired'));
  // IPv6 precisa de colchetes na URL.
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`;

  const url = new URL(`${f.tls.checked ? 'rediss' : 'redis'}://placeholder`);
  url.hostname = host;
  if (f.port.value) url.port = f.port.value;
  url.username = f.username.value.trim();
  url.password = f.password.value || (f.password.dataset.saved === 'true' ? PASSWORD_MASK : '');
  if (f.db.value) url.pathname = `/${f.db.value}`;
  return url.toString();
}

function fillFields(value) {
  const url = new URL(value);
  const f = form.elements;
  f.host.value = url.hostname.replace(/^\[|\]$/g, '');
  f.port.value = url.port;
  f.username.value = decodeURIComponent(url.username);
  f.tls.checked = url.protocol === 'rediss:';
  f.db.value = url.pathname.replace(/^\//, '');

  const saved = url.password === PASSWORD_MASK;
  f.password.value = saved ? '' : decodeURIComponent(url.password);
  f.password.dataset.saved = String(saved);
  f.password.placeholder = saved ? t('keepPassword') : '';
}

function formValues() {
  const data = new FormData(form);
  return {
    id: data.get('id') || undefined,
    name: data.get('name'),
    url: mode === 'url' ? data.get('url') : urlFromFields(),
    prefixes: data.get('prefixes'),
    readOnly: data.get('readOnly') === 'on',
  };
}

function openDialog(server) {
  form.reset();
  form.elements.password.dataset.saved = 'false';
  form.elements.password.placeholder = '';
  testResult.textContent = '';
  testResult.className = 'test-result';
  document.getElementById('dialog-title').textContent = t(server ? 'editServerTitle' : 'addServerTitle');
  mode = 'fields';
  setMode('fields');
  if (server) {
    form.elements.id.value = server.id;
    form.elements.name.value = server.name;
    form.elements.url.value = server.url;
    form.elements.prefixes.value = server.prefixes.join(', ');
    form.elements.readOnly.checked = server.readOnly;
    try {
      fillFields(server.url);
    } catch {
      setMode('url');
    }
  }
  dialog.showModal();
  form.elements.name.focus();
}

function showTest(message, ok) {
  testResult.textContent = message;
  testResult.className = `test-result ${ok ? 'ok' : 'err'}`;
}

document.getElementById('test-connection').onclick = async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  showTest(t('testing'), true);
  try {
    const result = await api('/api/test', { method: 'POST', body: JSON.stringify(formValues()) });
    if (result.ok) showTest(t('connected', { count: result.queues }), true);
    else showTest(t('testFailed', { error: result.error }), false);
  } catch (error) {
    showTest(error.message, false);
  } finally {
    button.disabled = false;
  }
};

document.getElementById('cancel').onclick = () => dialog.close();

form.onsubmit = async (event) => {
  event.preventDefault();
  try {
    const values = formValues();
    await api(values.id ? `/api/servers/${values.id}` : '/api/servers', {
      method: values.id ? 'PUT' : 'POST',
      body: JSON.stringify(values),
    });
    dialog.close();
    await loadServers();
  } catch (error) {
    showTest(error.message, false);
  }
};

// ---------- importar / exportar ----------

// O arquivo leva as senhas do Redis, por isso o sidecar o criptografa com uma senha do usuário.
const MIN_PASSWORD_LENGTH = 8;

const passwordDialog = document.getElementById('password-dialog');
const passwordForm = document.getElementById('password-form');
const passwordError = document.getElementById('password-error');
const passwordSubmit = document.getElementById('password-submit');
const importFile = document.getElementById('import-file');
let passwordAction;

/**
 * Pede a senha do arquivo. `action` recebe a senha; se lançar erro, ele aparece no diálogo, que
 * continua aberto para o usuário tentar de novo.
 */
function askPassword({ title, hint, submitLabel, confirm, action }) {
  passwordForm.reset();
  passwordError.textContent = '';
  document.getElementById('password-title').textContent = title;
  document.getElementById('password-hint').textContent = hint;
  document.getElementById('password-confirm').hidden = !confirm;
  passwordForm.elements.password.minLength = confirm ? MIN_PASSWORD_LENGTH : 0;
  passwordSubmit.textContent = submitLabel;
  passwordAction = { confirm, action };
  passwordDialog.showModal();
  passwordForm.elements.password.focus();
}

passwordForm.onsubmit = async (event) => {
  event.preventDefault();
  const { confirm, action } = passwordAction;
  const password = passwordForm.elements.password.value;
  if (confirm && password.length < MIN_PASSWORD_LENGTH) {
    passwordError.textContent = t('passwordTooShort', { min: MIN_PASSWORD_LENGTH });
    return;
  }
  if (confirm && password !== passwordForm.elements.confirm.value) {
    passwordError.textContent = t('passwordMismatch');
    return;
  }
  passwordSubmit.disabled = true;
  passwordError.textContent = '';
  try {
    await action(password);
    passwordDialog.close();
  } catch (error) {
    passwordError.textContent = error.message ?? String(error);
  } finally {
    passwordSubmit.disabled = false;
  }
};

document.getElementById('password-cancel').onclick = () => passwordDialog.close();

/** No app, o Tauri abre o diálogo "Salvar como"; no navegador, o próprio navegador baixa. */
async function saveFile(filename, contents) {
  const tauri = window.__TAURI_INTERNALS__;
  if (tauri) return tauri.invoke('save_export', { filename, contents });

  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
  return null;
}

document.getElementById('export-servers').onclick = () => {
  if (servers.length === 0) {
    alert(t('nothingToExport'));
    return;
  }
  askPassword({
    title: t('exportTitleDialog'),
    hint: t('exportHint'),
    submitLabel: t('export'),
    confirm: true,
    action: async (password) => {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || t('error', { status: response.status }));
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'bull-monitor.json';
      const contents = await response.text();
      // Fecha antes do "Salvar como" para os dois diálogos não ficarem empilhados.
      passwordDialog.close();
      try {
        const path = await saveFile(filename, contents);
        if (path) alert(t('exportedTo', { path }));
      } catch (error) {
        alert(t('saveFailed', { error: error.message ?? error }));
      }
    },
  });
};

async function importServers(file, password) {
  const { added, skipped } = await api('/api/import', {
    method: 'POST',
    body: JSON.stringify({ file, password }),
  });
  await loadServers();
  const extra = skipped > 0 ? ` ${t('skipped', { count: skipped })}` : '';
  return `${t('imported', { count: added })}${extra}`;
}

document.getElementById('import-servers').onclick = () => importFile.click();

importFile.onchange = async () => {
  const selected = importFile.files[0];
  importFile.value = '';
  if (!selected) return;
  let file;
  try {
    file = JSON.parse(await selected.text());
  } catch {
    alert(t('invalidJson'));
    return;
  }
  // Arquivos sem criptografia (como o servers.json) são importados direto.
  if (!file?.cipher) {
    importServers(file).then(alert, (error) => alert(t('importFailed', { error: error.message })));
    return;
  }
  askPassword({
    title: t('importTitleDialog'),
    hint: t('importHint', { file: selected.name }),
    submitLabel: t('import'),
    confirm: false,
    action: async (password) => {
      const message = await importServers(file, password);
      passwordDialog.close();
      alert(message);
    },
  });
};

document.getElementById('add-server').onclick = () => openDialog();
document.getElementById('refresh-all').onclick = () => refreshSummaries();

// Só atualiza com a tela visível: minimizado ou dentro de uma board, não gasta nada.
setInterval(() => {
  if (document.visibilityState === 'visible') refreshSummaries();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshSummaries();
});

loadServers().catch((error) => {
  empty.hidden = false;
  empty.textContent = t('loadFailed', { error: error.message });
});
