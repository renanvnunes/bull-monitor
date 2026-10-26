import { randomBytes, timingSafeEqual } from 'node:crypto';
import { BoardRegistry, testConnection } from './boards';
import { encryptServers, readImportFile } from './backup';
import {
  loadServers,
  loadSettings,
  maskUrl,
  parseServerInput,
  PASSWORD_MASK,
  saveServers,
  saveSettings,
  type ServerConfig,
  type ServerInput,
} from './config';
import { getLanguage, isLanguage, setLanguage, t } from './i18n';
// Importados como texto para ficarem embutidos no binário do `bun build --compile`.
import appCss from '../public/app.css' with { type: 'text' };
// @ts-ignore: o TypeScript não conhece `with { type: 'text' }` para arquivos .js.
import appJs from '../public/app.js' with { type: 'text' };
// @ts-ignore: idem.
import i18nJs from '../public/i18n.js' with { type: 'text' };
// @ts-ignore: idem.
import boardJs from '../public/board.js' with { type: 'text' };
import indexHtmlText from '../public/index.html' with { type: 'text' };
import logoSvg from '../public/logo.svg' with { type: 'text' };

// Os tipos do Bun descrevem .html como HTMLBundle; com `type: 'text'` é uma string.
const indexHtml = indexHtmlText as unknown as string;

type Handler = (request: Request & { params?: Record<string, string> }) => Response | Promise<Response>;
type Routes = Record<string, Record<string, Handler>>;

const HOST = '127.0.0.1';
const COOKIE = 'bm_token';
// O Tauri passa o token pelo ambiente; rodando sozinho, um token novo é gerado a cada execução.
const token = process.env.BULL_MONITOR_TOKEN || randomBytes(24).toString('hex');
// Dentro do binário compilado não existe node_modules; o Tauri informa onde está a interface.
const uiBasePath = process.env.BULL_BOARD_UI_PATH || undefined;

let servers: ServerConfig[] = await loadServers();
setLanguage((await loadSettings()).language);
const registry = new BoardRegistry(uiBasePath);
await registry.sync(servers);

// ---------- segurança ----------

function sameToken(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieToken(request: Request): string | undefined {
  const cookie = request.headers.get('cookie') ?? '';
  return cookie
    .split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === COOKIE)?.[1];
}

/**
 * Só atende 127.0.0.1/localhost (contra DNS rebinding) e só com o token, que chega uma vez
 * pela URL e depois fica num cookie HttpOnly. Assim outros programas da máquina e páginas
 * abertas no navegador não conseguem mexer nas filas.
 */
function guard(handler: Handler): Handler {
  return (request) => {
    const host = (request.headers.get('host') ?? '').replace(/:\d+$/, '');
    if (host !== HOST && host !== 'localhost') return new Response('Forbidden', { status: 403 });

    // Primeira abertura: troca o ?token= por um cookie e tira o token da URL. No app, o Tauri já
    // grava o cookie e navega sem o token (src-tauri/src/lib.rs); isto fica para o navegador e
    // para quando o Tauri não consegue gravar o cookie.
    const url = new URL(request.url);
    if (sameToken(url.searchParams.get('token'))) {
      url.searchParams.delete('token');
      return new Response(null, {
        status: 302,
        headers: {
          location: url.pathname + url.search,
          // Lax e não Strict: a janela chega aqui vinda da tela de carregamento (tauri://), e o
          // WebKit trata essa navegação como entre sites. Com Strict o cookie não ia junto no
          // redirecionamento e a página abria com "Unauthorized". O Lax continua barrando o
          // cookie em POST/PUT/DELETE vindos de outros sites, que é o que mexe nas filas.
          'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
        },
      });
    }

    if (!sameToken(cookieToken(request))) return new Response('Unauthorized', { status: 401 });
    return handler(request);
  };
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

function guardAll(routes: Routes): Routes {
  const guarded: Routes = {};
  for (const [path, methods] of Object.entries(routes)) {
    guarded[path] = Object.fromEntries(
      Object.entries(methods).map(([method, handler]) => [method, guard(handler)])
    );
  }
  return guarded;
}

// ---------- API da tela inicial ----------

const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (error: unknown, status = 400) =>
  json({ error: error instanceof Error ? error.message : String(error) }, status);

function publicServer(server: ServerConfig) {
  return { ...server, url: maskUrl(server.url) };
}

/** Ao editar, a interface devolve a URL mascarada; nesse caso a senha antiga é mantida. */
function keepPassword(input: ServerInput, previous?: ServerConfig): ServerInput {
  if (!previous) return input;
  const next = new URL(input.url);
  if (next.password !== PASSWORD_MASK) return input;
  next.password = new URL(previous.url).password;
  return { ...input, url: next.toString() };
}

async function persist(next: ServerConfig[]) {
  await saveServers(next);
  servers = next;
  await registry.sync(servers);
  reloadRoutes();
}

const withTimeout = <T>(promise: Promise<T>, ms: number, fallback: T) =>
  Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

const homeRoutes: Routes = {
  // Voltar para a tela inicial fecha as boards abertas e as conexões delas com o Redis.
  '/': {
    GET: () => {
      if (registry.closeBoards()) reloadRoutes();
      // O idioma vai no <html lang>: a página já monta traduzida, sem piscar em inglês.
      const html = indexHtml.replace('<html lang="en">', `<html lang="${getLanguage()}">`);
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  },
  '/app.js': { GET: () => new Response(appJs, { headers: { 'content-type': 'text/javascript' } }) },
  '/board.js': { GET: () => new Response(boardJs, { headers: { 'content-type': 'text/javascript' } }) },
  '/i18n.js': { GET: () => new Response(i18nJs, { headers: { 'content-type': 'text/javascript' } }) },
  '/app.css': { GET: () => new Response(appCss, { headers: { 'content-type': 'text/css' } }) },
  '/logo.svg': { GET: () => new Response(logoSvg, { headers: { 'content-type': 'image/svg+xml' } }) },

  // Fica no sidecar e não no localStorage: a porta muda a cada execução, e com ela a origem.
  '/api/settings': {
    PUT: async (request) => {
      const { language } = (await request.json().catch(() => null)) ?? {};
      if (!isLanguage(language)) return fail('Unsupported language.');
      await saveSettings({ language });
      setLanguage(language);
      return new Response(null, { status: 204 });
    },
  },

  '/api/servers': {
    GET: () => json(servers.map(publicServer)),
    POST: async (request) => {
      try {
        const input = parseServerInput(await request.json());
        const server: ServerConfig = { id: randomBytes(4).toString('hex'), ...input };
        await persist([...servers, server]);
        return json(publicServer(server), 201);
      } catch (error) {
        return fail(error);
      }
    },
  },

  '/api/servers/:id': {
    PUT: async (request) => {
      const previous = servers.find((s) => s.id === request.params?.id);
      if (!previous) return fail(t('serverNotFound'), 404);
      try {
        const input = keepPassword(parseServerInput(await request.json()), previous);
        const server: ServerConfig = { ...input, id: previous.id };
        await persist(servers.map((s) => (s.id === server.id ? server : s)));
        return json(publicServer(server));
      } catch (error) {
        return fail(error);
      }
    },
    DELETE: async (request) => {
      await persist(servers.filter((s) => s.id !== request.params?.id));
      return new Response(null, { status: 204 });
    },
  },

  '/api/servers/:id/summary': {
    GET: async (request) => {
      const runtime = registry.get(request.params?.id ?? '');
      if (!runtime) return fail(t('serverNotFound'), 404);
      const timedOut = {
        status: 'offline' as const,
        error: t('redisTimeout'),
        queues: 0, waiting: 0, active: 0, failed: 0, delayed: 0,
      };
      return json(await withTimeout(runtime.summary(), 8_000, timedOut));
    },
  },

  '/api/servers/:id/refresh': {
    POST: async (request) => {
      const runtime = registry.get(request.params?.id ?? '');
      if (!runtime) return fail(t('serverNotFound'), 404);
      try {
        return json({ queues: await runtime.refreshQueues() });
      } catch (error) {
        return fail(error, 502);
      }
    },
  },

  // A tela inicial abre a board por aqui, mostrando o carregamento, e só depois navega até ela.
  '/api/servers/:id/open': {
    POST: async (request) => {
      const runtime = registry.get(request.params?.id ?? '');
      if (!runtime) return fail(t('serverNotFound'), 404);
      try {
        await runtime.openBoard();
        reloadRoutes();
        return new Response(null, { status: 204 });
      } catch (error) {
        return fail(error, 502);
      }
    },
  },

  // Cancelar na tela de carregamento: a abertura em andamento desiste e a conexão é fechada.
  '/api/servers/:id/close': {
    POST: (request) => {
      const runtime = registry.get(request.params?.id ?? '');
      if (!runtime) return fail(t('serverNotFound'), 404);
      void runtime.close();
      reloadRoutes();
      return new Response(null, { status: 204 });
    },
  },

  // Único lugar em que as senhas saem do sidecar, e só criptografadas com a senha do usuário.
  '/api/export': {
    POST: async (request) => {
      try {
        const { password } = await request.json();
        const file = await encryptServers(servers, String(password ?? ''));
        const filename = t('exportFile', { date: new Date().toISOString().slice(0, 10) });
        return new Response(JSON.stringify(file, null, 2), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="${filename}"`,
            'cache-control': 'no-store',
          },
        });
      } catch (error) {
        return fail(error);
      }
    },
  },

  // Conexões com mesmo nome e URL de uma já cadastrada são ignoradas; as demais entram como novas.
  '/api/import': {
    POST: async (request) => {
      try {
        const body = await request.json().catch(() => null);
        const inputs = await readImportFile(body?.file, body?.password);
        const known = new Set(servers.map((s) => `${s.name}\n${s.url}`));
        const added: ServerConfig[] = [];
        for (const input of inputs) {
          const key = `${input.name}\n${input.url}`;
          if (known.has(key)) continue;
          known.add(key);
          added.push({ id: randomBytes(4).toString('hex'), ...input });
        }
        if (added.length > 0) await persist([...servers, ...added]);
        return json({ added: added.length, skipped: inputs.length - added.length });
      } catch (error) {
        return fail(error);
      }
    },
  },

  '/api/test': {
    POST: async (request) => {
      try {
        const body = await request.json();
        const input = keepPassword(parseServerInput(body), servers.find((s) => s.id === body.id));
        return json(await testConnection(input.url, input.prefixes));
      } catch (error) {
        return fail(error);
      }
    },
  },

  // Board ainda não aberta: cria, registra as rotas dela e recarrega a página.
  '/s/:id': { GET: (request) => openBoard(request) },
  '/s/:id/*': { GET: (request) => openBoard(request) },
};

async function openBoard(request: Request & { params?: Record<string, string> }) {
  const id = request.params?.id ?? '';
  const runtime = registry.get(id);
  if (!runtime) return redirect('/');
  // Só a navegação até a board a abre. Uma consulta atrasada da board (o bull-board atualiza
  // sozinho) que chegue depois de voltar para a tela inicial não deve reabrir a conexão.
  if (!request.headers.get('accept')?.includes('text/html')) return new Response('Not Found', { status: 404 });
  // Board já aberta e mesmo assim caiu aqui: é uma URL que ela não conhece.
  if (runtime.routes) return new Response('Not Found', { status: 404 });
  try {
    await runtime.openBoard();
    reloadRoutes();
    const url = new URL(request.url);
    return redirect(url.pathname + url.search);
  } catch (error) {
    const message = t('openFailed', {
      name: Bun.escapeHTML(runtime.config.name),
      error: Bun.escapeHTML(error instanceof Error ? error.message : String(error)),
    });
    return new Response(
      `<meta charset="utf-8"><p>${message}</p><a href="/">${t('back')}</a>`,
      { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
}

// ---------- servidor ----------

/**
 * Põe o /board.js no início do <head> das páginas da board, antes dos scripts do bull-board:
 * ele aplica o idioma do app e esconde o que não interessa (veja public/board.js).
 */
function withBoardScript(routes: Routes): Routes {
  const wrapped: Routes = {};
  for (const [path, methods] of Object.entries(routes)) {
    wrapped[path] = Object.fromEntries(
      Object.entries(methods).map(([method, handler]) => [
        method,
        async (request: Parameters<Handler>[0]) => {
          const response = await handler(request);
          if (!response.headers.get('content-type')?.startsWith('text/html')) return response;
          const script = `<script src="/board.js" data-lang="${getLanguage()}"></script>`;
          return new HTMLRewriter()
            .on('head', { element: (head) => void head.prepend(script, { html: true }) })
            .transform(response);
        },
      ])
    );
  }
  return wrapped;
}

/** Rotas exatas das boards abertas têm prioridade sobre os curingas /s/:id/* da tela inicial. */
function allRoutes(): Routes {
  return guardAll({ ...homeRoutes, ...withBoardScript(registry.openRoutes() as Routes) });
}

const notFound = guard(() => new Response('Not Found', { status: 404 }));

const server = Bun.serve({
  hostname: HOST,
  port: Number(process.env.PORT ?? 0),
  routes: allRoutes(),
  fetch: notFound,
});

function reloadRoutes() {
  server.reload({ routes: allRoutes() as any, fetch: notFound });
}

// O Tauri lê esta linha no stdout para saber para onde apontar a janela.
console.log(`BULL_MONITOR_READY ${server.url.origin}/?token=${token}`);

async function shutdown() {
  server.stop(true);
  await registry.closeAll();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Se o app Tauri cair sem matar o sidecar, o stdin fecha; sair evita processo órfão.
if (process.env.BULL_MONITOR_EXIT_ON_STDIN_CLOSE === '1') {
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  process.stdin.resume();
}
