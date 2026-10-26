// Cria filas de exemplo num Redis para testar o painel.
// Uso: bun scripts/seed.ts redis://localhost:6379
import Bull from 'bull';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const url = process.argv[2] ?? 'redis://localhost:6379';
const connection = new Redis(url, { maxRetriesPerRequest: null });

for (const name of ['emails', 'relatorios']) {
  const queue = new Queue(name, { connection });
  await queue.addBulk(
    Array.from({ length: 20 }, (_, i) => ({ name: 'tarefa', data: { i }, opts: { delay: i % 5 === 0 ? 60_000 : 0 } }))
  );

  // Processa alguns jobs, falhando parte deles, e para.
  let processed = 0;
  const worker = new Worker(
    name,
    async (job) => {
      processed++;
      if (job.data.i % 3 === 0) throw new Error(`Falha simulada no job ${job.id}`);
      return { ok: true };
    },
    { connection, concurrency: 5 }
  );
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await worker.close();
  await queue.close();
  console.log(`BullMQ "${name}": ${processed} processados`);
}

const legacy = new Bull('legado', url);
for (let i = 0; i < 5; i++) await legacy.add({ i });
await legacy.close();
console.log('Bull "legado": 5 jobs');

await connection.quit();
