// Adaptado de bull-board/packages/cli/src/discovery (https://github.com/felixmosh/bull-board).
// Copyright (c) 2019 Vitor Capretz. Licença MIT; veja THIRD_PARTY_NOTICES.md.
import type { Redis } from 'ioredis';

export interface DiscoveredQueue {
  prefix: string;
  name: string;
  lib: 'bull' | 'bullmq';
}

/**
 * Bull e BullMQ são diferenciados pelo formato das chaves: o BullMQ grava `<prefix>:<fila>:meta`,
 * o Bull grava `<prefix>:<fila>:id` e nunca `:meta`.
 */
const BULLMQ_MARKER = 'meta';
const BULL_MARKER = 'id';

/**
 * Chaves examinadas por chamada. O MATCH é aplicado depois, então o SCAN passa pelo banco inteiro;
 * lotes maiores fazem menos idas e voltas, e cada chamada ainda leva poucos milissegundos no Redis.
 */
const SCAN_COUNT = 2_000;

async function scanKeys(client: Redis, pattern: string, onKey: (key: string) => void) {
  let cursor = '0';
  do {
    const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', SCAN_COUNT);
    cursor = next;
    keys.forEach(onKey);
  } while (cursor !== '0');
}

/** Nomes de fila podem conter ":", então corta prefixo e sufixo conhecidos em vez de dividir. */
function queueNameOf(key: string, prefix: string, marker: string): string | null {
  const head = `${prefix}:`;
  const tail = `:${marker}`;
  if (!key.startsWith(head) || !key.endsWith(tail)) return null;
  const name = key.slice(head.length, key.length - tail.length);
  return name.length > 0 ? name : null;
}

export async function discoverQueues(client: Redis, prefixes: string[]): Promise<DiscoveredQueue[]> {
  const found = new Map<string, DiscoveredQueue>();

  for (const prefix of prefixes) {
    const bullmqNames = new Set<string>();

    await scanKeys(client, `${prefix}:*:${BULLMQ_MARKER}`, (key) => {
      const name = queueNameOf(key, prefix, BULLMQ_MARKER);
      if (name) bullmqNames.add(name);
    });
    for (const name of bullmqNames) found.set(`${prefix}:${name}`, { prefix, name, lib: 'bullmq' });

    await scanKeys(client, `${prefix}:*:${BULL_MARKER}`, (key) => {
      const name = queueNameOf(key, prefix, BULL_MARKER);
      if (!name || bullmqNames.has(name)) return;
      found.set(`${prefix}:${name}`, { prefix, name, lib: 'bull' });
    });
  }

  return [...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, queue]) => queue);
}
