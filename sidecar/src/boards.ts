import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BunAdapter } from '@bull-board/bun';
import BullQueue from 'bull';
import { Queue as BullMQQueue } from 'bullmq';
import { Redis } from 'ioredis';
import type { ServerConfig } from './config';
import { discoverQueues, type DiscoveredQueue } from './discovery';
import { getLanguage, t } from './i18n';

type BunRoutes = ReturnType<BunAdapter['getRoutes']>;

export interface ServerSummary {
  status: 'online' | 'offline';
  error?: string;
  queues: number;
  waiting: number;
  active: number;
  failed: number;
  delayed: number;
}

interface QueueHandle {
  adapter: BullAdapter | BullMQAdapter;
  close(): Promise<void>;
}

// O ioredis avisa "does not require a password" a cada conexão, e o resumo da tela inicial
// conecta de novo a cada atualização. O aviso é útil uma vez; repetido, só enche o log.
const shownWarnings = new Set<string>();
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const [message] = args;
  if (typeof message === 'string' && message.includes('does not require a password')) {
    if (shownWarnings.has(message)) return;
    shownWarnings.add(message);
    return warn(message, '(as próximas ocorrências serão omitidas; apague a senha da conexão para resolver)');
  }
  warn(...args);
};

export function redisOptions() {
  return {
    lazyConnect: true,
    connectTimeout: 5_000,
    // Um servidor fora do ar deve dar erro na tela, não deixar as requisições penduradas.
    maxRetriesPerRequest: 2,
    retryStrategy: (times: number) => Math.min(times * 1_000, 10_000),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Abre uma conexão só para esta operação e a fecha no fim, mesmo com erro. */
async function withTemporaryClient<T>(url: string, fn: (client: Redis) => Promise<T>): Promise<T> {
  const client = new Redis(url, { ...redisOptions(), retryStrategy: () => null });
  // O erro útil (senha errada, host não encontrado) chega pelo evento; a promise só diz
  // "Connection is closed".
  let lastError: unknown;
  client.on('error', (error) => (lastError = error));
  try {
    await client.connect();
    return await fn(client);
  } catch (error) {
    throw new Error(errorMessage(lastError ?? error));
  } finally {
    client.disconnect();
  }
}

/**
 * Estado de um servidor: filas descobertas e, enquanto a board está aberta, a conexão e a board.
 * Fora da board nenhuma conexão fica aberta: o resumo da tela inicial conecta, consulta e fecha.
 */
class ServerRuntime {
  private client?: Redis;
  private bullSubscriber?: Redis;
  private lastConnectionError?: unknown;
  private discovered?: DiscoveredQueue[];
  private handles: QueueHandle[] = [];
  private board?: ReturnType<typeof createBullBoard>;
  private opening?: Promise<BunRoutes>;
  routes?: BunRoutes;

  constructor(
    readonly config: ServerConfig,
    private readonly uiBasePath: string | undefined
  ) {}

  private getClient(): Redis {
    if (!this.client) {
      this.client = new Redis(this.config.url, redisOptions());
      // Sem listener, o ioredis registra cada falha de reconexão como "unhandled error".
      // Guarda o erro: ele diz o motivo real (ECONNREFUSED, WRONGPASS), a promise não.
      this.client.on('error', (error) => (this.lastConnectionError = error));
      this.client.on('ready', () => (this.lastConnectionError = undefined));
    }
    return this.client;
  }

  /** Usa a conexão da board, se estiver aberta; senão, uma conexão temporária. */
  private async withClient<T>(fn: (client: Redis) => Promise<T>): Promise<T> {
    if (!this.client) return withTemporaryClient(this.config.url, fn);
    try {
      return await fn(this.client);
    } catch (error) {
      throw new Error(errorMessage(this.lastConnectionError ?? error));
    }
  }

  /**
   * A descoberta faz SCAN no banco inteiro, inclusive nas chaves que não são de fila (cache etc.).
   * Por isso só roda na primeira vez e quando pedem (botão de procurar filas novas).
   */
  private async discover(client: Redis, force = false): Promise<DiscoveredQueue[]> {
    if (!force && this.discovered) return this.discovered;
    this.discovered = await discoverQueues(client, this.config.prefixes);
    return this.discovered;
  }

  async summary(): Promise<ServerSummary> {
    const empty = { queues: 0, waiting: 0, active: 0, failed: 0, delayed: 0 };
    try {
      return await this.withClient(async (client) => {
        const queues = await this.discover(client);
        const pipeline = client.pipeline();
        for (const { prefix, name } of queues) {
          const key = `${prefix}:${name}`;
          pipeline.llen(`${key}:wait`);
          pipeline.llen(`${key}:active`);
          pipeline.zcard(`${key}:failed`);
          pipeline.zcard(`${key}:delayed`);
        }
        const results = queues.length > 0 ? ((await pipeline.exec()) ?? []) : [];
        const at = (i: number) => Number(results[i]?.[1] ?? 0);

        const summary: ServerSummary = { status: 'online', ...empty, queues: queues.length };
        queues.forEach((_, q) => {
          summary.waiting += at(q * 4);
          summary.active += at(q * 4 + 1);
          summary.failed += at(q * 4 + 2);
          summary.delayed += at(q * 4 + 3);
        });
        return summary;
      });
    } catch (error) {
      return { status: 'offline', error: errorMessage(error), ...empty };
    }
  }

  private createQueue({ prefix, name, lib }: DiscoveredQueue): QueueHandle {
    const options = { readOnlyMode: this.config.readOnly };
    const client = this.getClient();

    if (lib === 'bullmq') {
      // O painel só lê as filas que encontrou; não deve reescrever o hash meta delas.
      const queue = new BullMQQueue(name, { connection: client, prefix, skipMetasUpdate: true });
      queue.on('error', () => {});
      return { adapter: new BullMQAdapter(queue, options), close: () => queue.close() };
    }

    const queue = new BullQueue(name, {
      prefix,
      createClient: (type) => {
        if (type === 'client') return client as any;
        // O Bull recusa um subscriber com enableReadyCheck ou maxRetriesPerRequest definidos.
        this.bullSubscriber ??= client.duplicate({ enableReadyCheck: false, maxRetriesPerRequest: null });
        return this.bullSubscriber as any;
      },
    });
    queue.on('error', () => {});
    return { adapter: new BullAdapter(queue, options), close: () => queue.close() };
  }

  /** Conecta e cria a board. Pedidos simultâneos (página e favicon, por exemplo) esperam a mesma. */
  openBoard(): Promise<BunRoutes> {
    if (this.routes) return Promise.resolve(this.routes);
    this.opening ??= this.createBoard().finally(() => (this.opening = undefined));
    return this.opening;
  }

  private async createBoard(): Promise<BunRoutes> {
    const client = this.getClient();
    let queues: DiscoveredQueue[];
    try {
      queues = await this.withClient((c) => this.discover(c));
    } catch (error) {
      if (this.client === client) await this.close();
      throw error;
    }
    // Voltaram para a tela inicial enquanto a descoberta rodava: não reabre a conexão.
    if (this.client !== client) throw new Error(t('boardClosed'));
    this.handles = queues.map((q) => this.createQueue(q));

    const serverAdapter = new BunAdapter();
    serverAdapter.setBasePath(`/s/${this.config.id}`);
    this.board = createBullBoard({
      queues: this.handles.map((h) => h.adapter),
      serverAdapter,
      options: {
        uiBasePath: this.uiBasePath,
        uiConfig: {
          boardTitle: this.config.name,
          // Ícone do Bull Monitor (servido pela tela inicial) no lugar do logo do bull-board.
          boardLogo: { path: '/logo.svg', width: 24, height: 24 },
          favIcon: { default: '/logo.svg', alternative: '/logo.svg' },
          // Segue o idioma da tela inicial; a board é recriada a cada abertura.
          locale: { lng: getLanguage() },
          hideDocsLink: true,
          miscLinks: [{ text: `← ${t('servers')}`, url: '/' }],
        },
      },
    });
    this.routes = serverAdapter.getRoutes();
    return this.routes;
  }

  /** Procura filas novas (ou removidas) sem recriar a board. */
  async refreshQueues(): Promise<number> {
    const queues = await this.withClient((client) => this.discover(client, true));
    if (!this.board) return queues.length;

    const old = this.handles;
    this.handles = queues.map((q) => this.createQueue(q));
    this.board.replaceQueues(this.handles.map((h) => h.adapter));
    await Promise.allSettled(old.map((h) => h.close()));
    return queues.length;
  }

  /**
   * Fecha a board e as conexões dela. O estado é desligado antes do primeiro await, então quem
   * chama pode recarregar as rotas na hora, sem esperar o Redis confirmar o fechamento.
   */
  async close(): Promise<void> {
    const { handles, bullSubscriber, client } = this;
    this.handles = [];
    this.client = this.bullSubscriber = undefined;
    this.lastConnectionError = undefined;
    this.board = this.routes = undefined;
    await Promise.allSettled(handles.map((h) => h.close()));
    await Promise.allSettled([bullSubscriber?.quit(), client?.quit()]);
  }
}

export class BoardRegistry {
  private runtimes = new Map<string, ServerRuntime>();

  constructor(private readonly uiBasePath: string | undefined) {}

  get(id: string): ServerRuntime | undefined {
    return this.runtimes.get(id);
  }

  /** Sincroniza com a config: cria o que é novo e fecha o que mudou ou foi removido. */
  async sync(servers: ServerConfig[]): Promise<void> {
    const wanted = new Map(servers.map((s) => [s.id, s]));

    for (const [id, runtime] of this.runtimes) {
      const next = wanted.get(id);
      if (!next || JSON.stringify(next) !== JSON.stringify(runtime.config)) {
        await runtime.close();
        this.runtimes.delete(id);
      }
    }
    for (const server of servers) {
      if (!this.runtimes.has(server.id)) {
        this.runtimes.set(server.id, new ServerRuntime(server, this.uiBasePath));
      }
    }
  }

  /** Rotas de todas as boards já abertas, para juntar com as rotas da tela inicial. */
  openRoutes(): BunRoutes {
    const all: BunRoutes = {};
    for (const runtime of this.runtimes.values()) Object.assign(all, runtime.routes ?? {});
    return all;
  }

  /** Fecha as boards abertas sem esperar o Redis. Diz se fechou alguma (as rotas mudaram). */
  closeBoards(): boolean {
    const open = [...this.runtimes.values()].filter((r) => r.routes);
    for (const runtime of open) void runtime.close();
    return open.length > 0;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.runtimes.values()].map((r) => r.close()));
    this.runtimes.clear();
  }
}

/** Testa uma URL sem salvar: conecta, faz PING e conta as filas. */
export async function testConnection(url: string, prefixes: string[]) {
  try {
    const queues = await withTemporaryClient(url, async (client) => {
      await client.ping();
      return discoverQueues(client, prefixes);
    });
    return { ok: true as const, queues: queues.length };
  } catch (error) {
    return { ok: false as const, error: errorMessage(error) };
  }
}
