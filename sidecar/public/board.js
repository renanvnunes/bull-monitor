// Injetado pelo sidecar no início do <head> das páginas da board, antes dos scripts do bull-board.
//
// O idioma do app e o select de idioma das configurações da board são um só: a board abre no
// idioma do app, e trocar lá salva no sidecar, valendo também para a tela inicial. O bull-board
// guarda as configurações no localStorage, que se perde a cada execução (a porta muda, e com ela
// a origem); por isso o idioma fica no sidecar.
(() => {
  const SETTINGS_KEY = 'board-settings';
  // Versão do formato salvo pelo bull-board; com outra, ele tentaria migrar o que gravarmos.
  const SETTINGS_VERSION = 2;
  let language = document.currentScript.dataset.lang;

  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') ?? { version: SETTINGS_VERSION };
    saved.state = { ...saved.state, language };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(saved));
  } catch {
    // Sem localStorage a board usa o locale do uiConfig, que já é o idioma do app.
  }

  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    setItem.call(this, key, value);
    if (this !== localStorage || key !== SETTINGS_KEY) return;
    let next;
    try {
      next = JSON.parse(value)?.state?.language;
    } catch {
      return;
    }
    if (!next || next === language) return;
    language = next;
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ language }),
    }).catch(() => {});
  };

  // Sem opção no uiConfig para esconder o link de versão do bull-board (ícone do GitHub + número).
  // O seletor pelo href sobrevive às classes com hash que mudam a cada versão.
  const style = document.createElement('style');
  style.textContent = 'a[href="https://github.com/felixmosh/bull-board/releases"] { display: none !important; }';
  document.head.append(style);
})();
