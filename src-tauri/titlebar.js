// Barra de título própria do Bull Monitor. O Tauri injeta este script em toda página carregada na
// janela principal (carregamento, tela de servidores e boards do bull-board), antes dos scripts dela.
(() => {
  if (window.top !== window || window.__bullMonitorTitlebar) return;
  window.__bullMonitorTitlebar = true;

  const HEIGHT = 32;
  // Raio dos cantos da janela. Some quando ela está maximizada.
  const RADIUS = '20px';
  const invoke = (cmd) => window.__TAURI_INTERNALS__?.invoke(`plugin:window|${cmd}`, { label: 'main' });

  const icons = {
    minimize: '<svg viewBox="0 0 10 10"><path d="M1 5h8"/></svg>',
    maximize: '<svg viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7"/></svg>',
    restore:
      '<svg viewBox="0 0 10 10"><rect x="1.5" y="3" width="5.5" height="5.5"/><path d="M3 3V1.5h5.5V7H7"/></svg>',
    close: '<svg viewBox="0 0 10 10"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7"/></svg>',
  };

  // As duas páginas (tela de servidores e bull-board) definem --card, --border e um texto
  // principal; os fallbacks cobrem a tela de carregamento, que não define nada.
  const css = `
    #bm-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: ${HEIGHT}px; z-index: 2147483647;
      display: flex; align-items: center; box-sizing: border-box;
      background: var(--card, #ffffff); color: var(--foreground, var(--fg, #1d2330));
      border-bottom: 1px solid var(--border, rgba(127,127,127,.25));
      font: 500 12.5px system-ui, -apple-system, 'Segoe UI', sans-serif;
      user-select: none; -webkit-user-select: none; cursor: default;
    }
    /* Só a tela de carregamento cai nos fallbacks; as outras páginas definem as variáveis. */
    @media (prefers-color-scheme: dark) {
      #bm-titlebar { background: var(--card, #1b1f27); color: var(--foreground, var(--fg, #e6e9ef)); }
    }
    #bm-titlebar .bm-title {
      flex: 1; height: 100%; display: flex; align-items: center; gap: 8px; padding-left: 12px;
      overflow: hidden; white-space: nowrap; text-overflow: ellipsis; opacity: .85;
    }
    #bm-titlebar .bm-title img { width: 16px; height: 16px; pointer-events: none; }
    #bm-titlebar .bm-title span { pointer-events: none; overflow: hidden; text-overflow: ellipsis; }
    #bm-titlebar button {
      all: unset; width: 46px; height: 100%; display: grid; place-items: center; color: inherit;
    }
    #bm-titlebar button:hover { background: rgba(127,127,127,.18); }
    #bm-titlebar button.bm-close:hover { background: #e81123; color: #fff; }
    #bm-titlebar svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1; }

    /* Desloca a página inteira para baixo da barra. O transform faz do body o bloco de
       referência dos elementos position:fixed (cabeçalho e menu lateral do bull-board, modais,
       avisos), então eles descem junto em vez de ficarem embaixo da barra.
       O body não pode ser também quem rola: elementos fixos presos a um ancestral com transform
       rolam junto com o conteúdo dele, e o cabeçalho do bull-board sumiria ao rolar. Por isso o
       conteúdo vai para o #bm-scroll, e só ele rola. */
    html.bm-framed { overflow: hidden; }
    html.bm-framed body {
      position: fixed !important; top: ${HEIGHT}px; left: 0; right: 0; bottom: 0;
      height: auto !important; margin: 0; overflow: hidden; transform: translateZ(0);
    }
    #bm-scroll { position: absolute; inset: 0; overflow: auto; }

    /* Cantos arredondados. A janela é transparente; o fundo quase transparente no html impede
       que o fundo do body seja estendido para a janela inteira (regra do CSS para o elemento
       raiz), e assim o body pinta só a própria caixa, com os cantos de baixo arredondados. */
    html.bm-framed { background: rgba(0, 0, 0, 0.004) !important; }
    html.bm-framed body {
      background-color: var(--background, var(--bg, #f6f7f9));
      /* clip-path e não border-radius: a barra de rolagem ignora o border-radius. */
      clip-path: inset(0 round 0 0 var(--bm-radius) var(--bm-radius));
    }
    @media (prefers-color-scheme: dark) {
      html.bm-framed body { background-color: var(--background, var(--bg, #12151b)); }
    }
    html.bm-framed { --bm-radius: ${RADIUS}; }
    html.bm-framed.bm-maximized { --bm-radius: 0px; }

    #bm-titlebar { border-radius: var(--bm-radius) var(--bm-radius) 0 0; }
    #bm-titlebar .bm-close { border-top-right-radius: var(--bm-radius); }
  `;

  function mount() {
    if (document.getElementById('bm-titlebar')) return;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.documentElement.classList.add('bm-framed');

    // O que já está no body (incluindo a raiz do React, que continua funcionando ao ser movida)
    // passa para o contêiner que rola. Modais e avisos que o app anexar depois ficam direto no
    // body, presos à janela, como devem.
    const scroller = document.createElement('div');
    scroller.id = 'bm-scroll';
    scroller.append(...document.body.childNodes);
    document.body.appendChild(scroller);

    const bar = document.createElement('div');
    bar.id = 'bm-titlebar';
    // data-tauri-drag-region: arrastar move a janela e duplo clique maximiza (tratado pelo Tauri).
    bar.innerHTML = `
      <div class="bm-title" data-tauri-drag-region><img alt="" /><span></span></div>
      <button type="button" class="bm-min" title="Minimizar">${icons.minimize}</button>
      <button type="button" class="bm-max" title="Maximizar">${icons.maximize}</button>
      <button type="button" class="bm-close" title="Fechar">${icons.close}</button>`;
    // Fora do body: assim não é deslocada nem cortada junto com a página.
    document.documentElement.appendChild(bar);

    bar.querySelector('.bm-min').onclick = () => invoke('minimize');
    bar.querySelector('.bm-max').onclick = () => invoke('toggle_maximize');
    bar.querySelector('.bm-close').onclick = () => invoke('close');

    const titleText = bar.querySelector('.bm-title span');
    const titleIcon = bar.querySelector('.bm-title img');
    const syncTitle = () => {
      titleText.textContent = document.title || 'Bull Monitor';
      const favicon = document.querySelector('link[rel~="icon"]');
      titleIcon.hidden = !favicon;
      if (favicon) titleIcon.src = favicon.href;
    };
    syncTitle();
    new MutationObserver(syncTitle).observe(document.head, { subtree: true, childList: true, characterData: true });

    // O tema escuro do bull-board é a classe dark-mode no body; a barra está fora dele, então copia
    // a classe para herdar as mesmas variáveis de cor.
    const syncTheme = () => bar.classList.toggle('dark-mode', document.body.classList.contains('dark-mode'));
    syncTheme();
    new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });

    const maxButton = bar.querySelector('.bm-max');
    const syncMaximized = async () => {
      const maximized = await window.__TAURI_INTERNALS__
        ?.invoke('plugin:window|is_maximized', { label: 'main' })
        .catch(() => false);
      document.documentElement.classList.toggle('bm-maximized', Boolean(maximized));
      maxButton.innerHTML = maximized ? icons.restore : icons.maximize;
      maxButton.title = maximized ? 'Restaurar' : 'Maximizar';
    };
    syncMaximized();
    window.addEventListener('resize', syncMaximized);
  }

  // Quem rola é o #bm-scroll e não a janela; o bull-board volta ao topo ao trocar de página com
  // window.scrollTo, então repassa a chamada.
  const scrollTo = window.scrollTo.bind(window);
  window.scrollTo = (...args) => {
    scrollTo(...args);
    document.getElementById('bm-scroll')?.scrollTo(...args);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
