import { createCipheriv, createDecipheriv, randomBytes, scrypt, type ScryptOptions } from 'node:crypto';
import { parseServerInput, type ServerConfig, type ServerInput } from './config';
import { t } from './i18n';

// Exportação e importação de conexões. O arquivo leva as URLs completas, então as senhas do Redis
// vão nele; por isso ele é criptografado com uma senha escolhida pelo usuário na exportação.
//
// AES-256-GCM com a chave derivada da senha por scrypt. O GCM autentica o conteúdo, então senha
// errada e arquivo adulterado dão o mesmo erro, sem chance de importar lixo.

const APP = 'bull-monitor';
const VERSION = 2;
export const MIN_PASSWORD_LENGTH = 8;

// N = 2^17 leva uns 250 ms e 128 MB: imperceptível para o usuário, caro para quem testa senhas.
const KDF = { name: 'scrypt', N: 2 ** 17, r: 8, p: 1 } as const;

interface KdfParams {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
}

interface EncryptedFile {
  app: typeof APP;
  version: typeof VERSION;
  exportedAt: string;
  cipher: 'aes-256-gcm';
  kdf: KdfParams;
  iv: string;
  tag: string;
  data: string;
}

function deriveKey(password: string, kdf: KdfParams): Promise<Buffer> {
  const options: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 };
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFC'), Buffer.from(kdf.salt, 'base64'), 32, options, (error, key) =>
      error ? reject(error) : resolve(key)
    )
  );
}

/** Cabeçalho autenticado junto com os dados: trocar parâmetros no arquivo também invalida a senha. */
const aad = (file: Pick<EncryptedFile, 'app' | 'version' | 'kdf'>) =>
  Buffer.from(JSON.stringify([file.app, file.version, file.kdf]));

export async function encryptServers(servers: ServerConfig[], password: string): Promise<EncryptedFile> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(t('passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
  }
  const plain: ServerInput[] = servers.map(({ name, url, prefixes, readOnly }) => ({ name, url, prefixes, readOnly }));
  const kdf: KdfParams = { ...KDF, salt: randomBytes(16).toString('base64') };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(password, kdf), iv);
  cipher.setAAD(aad({ app: APP, version: VERSION, kdf }));
  const data = Buffer.concat([cipher.update(JSON.stringify({ servers: plain })), cipher.final()]);
  return {
    app: APP,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    cipher: 'aes-256-gcm',
    kdf,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export const isEncrypted = (file: unknown): file is EncryptedFile =>
  (file as EncryptedFile | null)?.app === APP && (file as EncryptedFile).cipher === 'aes-256-gcm';

async function decrypt(file: EncryptedFile, password: string): Promise<unknown> {
  const { kdf } = file;
  // Limites para um arquivo forjado não travar o sidecar com um scrypt gigante.
  const sane =
    file.version === VERSION &&
    kdf?.name === 'scrypt' &&
    [kdf.N, kdf.r, kdf.p].every(Number.isInteger) &&
    kdf.N >= 2 ** 14 && kdf.N <= 2 ** 20 && (kdf.N & (kdf.N - 1)) === 0 &&
    kdf.r >= 1 && kdf.r <= 16 && kdf.p >= 1 && kdf.p <= 4;
  if (!sane) throw new Error(t('unsupportedFile'));

  try {
    const decipher = createDecipheriv('aes-256-gcm', await deriveKey(password, kdf), Buffer.from(file.iv, 'base64'));
    decipher.setAAD(aad(file));
    decipher.setAuthTag(Buffer.from(file.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    throw new Error(t('wrongPassword'));
  }
}

/**
 * Lê o arquivo importado: o exportado criptografado (pede `password`) ou um sem criptografia,
 * como o próprio servers.json. Lança Error com mensagem para o usuário, dizendo qual conexão
 * está inválida.
 */
export async function readImportFile(file: unknown, password: unknown): Promise<ServerInput[]> {
  let content = file;
  if (isEncrypted(file)) {
    if (typeof password !== 'string' || !password) throw new Error(t('passwordRequired'));
    content = await decrypt(file, password);
  }

  const list = (content as { servers?: unknown } | null)?.servers;
  if (!Array.isArray(list)) throw new Error(t('noServerList'));
  return list.map((item, index) => {
    try {
      return parseServerInput(item);
    } catch (error) {
      const name = String((item as { name?: unknown })?.name ?? '').trim() || `#${index + 1}`;
      throw new Error(t('invalidConnection', { name, error: (error as Error).message }));
    }
  });
}
