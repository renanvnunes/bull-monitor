import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseLanguage, t, type Language } from './i18n';

export interface ServerConfig {
  id: string;
  name: string;
  /** redis:// ou rediss:// (TLS), com usuário, senha e db opcionais. */
  url: string;
  /** Prefixos das chaves das filas. O padrão do Bull e do BullMQ é "bull". */
  prefixes: string[];
  readOnly: boolean;
}

export type ServerInput = Omit<ServerConfig, 'id'>;

function configDir(): string {
  if (process.env.BULL_MONITOR_CONFIG_DIR) return process.env.BULL_MONITOR_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'bull-monitor');
}

const configFile = () => join(configDir(), 'servers.json');
const settingsFile = () => join(configDir(), 'settings.json');

async function readJson(file: string): Promise<any> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Grava num arquivo temporário e renomeia, para não corromper a config se o app cair no meio. */
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

export async function loadServers(): Promise<ServerConfig[]> {
  const parsed = await readJson(configFile());
  return Array.isArray(parsed?.servers) ? parsed.servers : [];
}

export async function saveServers(servers: ServerConfig[]): Promise<void> {
  await writeJson(configFile(), { servers });
}

export interface Settings {
  language: Language;
}

/** Preferências da interface. Arquivo ausente ou idioma desconhecido voltam ao padrão. */
export async function loadSettings(): Promise<Settings> {
  const parsed = await readJson(settingsFile()).catch(() => undefined);
  return { language: parseLanguage(parsed?.language) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await writeJson(settingsFile(), settings);
}

/** Valida e normaliza o que vem do formulário. Lança Error com mensagem para o usuário. */
export function parseServerInput(body: unknown): ServerInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const name = String(raw.name ?? '').trim();
  const url = String(raw.url ?? '').trim();

  if (!name) throw new Error(t('nameRequired'));

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(t('invalidUrl'));
  }
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(t('invalidProtocol'));
  }

  const rawPrefixes = Array.isArray(raw.prefixes) ? raw.prefixes : String(raw.prefixes ?? '').split(',');
  const prefixes = rawPrefixes.map((p) => String(p).trim()).filter(Boolean);
  if (prefixes.some((p) => p.includes('*'))) {
    throw new Error(t('wildcardPrefix'));
  }

  return {
    name,
    url,
    prefixes: prefixes.length > 0 ? prefixes : ['bull'],
    readOnly: raw.readOnly === true,
  };
}

/** Marcador que a interface recebe no lugar da senha. */
export const PASSWORD_MASK = '****';

/** Nunca devolve a senha para a interface; ela só sai do disco para o ioredis. */
export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = PASSWORD_MASK;
    return parsed.toString();
  } catch {
    return url;
  }
}
