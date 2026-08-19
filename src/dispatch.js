import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { sleep, color } from './utils.js';
import { sendWithRetry } from './mailer.js';
import { buildSubject, buildText, buildHTML } from './template.js';

export async function readLog(logPath, { drawFingerprint = null } = {}) {
  if (!existsSync(logPath)) return new Map();
  const content = await readFile(logPath, 'utf8');
  const state = new Map();
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (drawFingerprint && record.draw !== drawFingerprint) continue;
      state.set(record.email, record);
    } catch { /* linha truncada por queda abrupta */ }
  }
  return state;
}

export async function saveDraw(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function sendAll({ config, pairs, logPath, drawFingerprint, dryRun = false }) {
  await mkdir(path.dirname(logPath), { recursive: true });
  const alreadyProcessed = await readLog(logPath, { drawFingerprint });
  const everyRecord = await readLog(logPath);
  const foreignRecords = everyRecord.size - alreadyProcessed.size;

  const queue = pairs.filter(({ giver }) => {
    const previous = alreadyProcessed.get(giver.email);
    if (!previous) return true;
    return previous.status !== 'sent';
  });

  const skipped = pairs.length - queue.length;
  console.log(color.info(`\nFila de envio: ${queue.length} de ${pairs.length} participantes.`));
  if (skipped > 0) console.log(color.dim(`  (${skipped} já haviam sido enviados com sucesso)`));
  if (foreignRecords > 0) {
    console.log(color.dim(`  (${foreignRecords} registro(s) de outro sorteio ignorados)`));
  }
  if (dryRun) console.log(color.warn('  MODO SIMULAÇÃO — nenhum e-mail será realmente enviado.\n'));

  const results = [];

  for (let i = 0; i < queue.length; i++) {
    const { giver, receiver } = queue[i];
    const context = {
      name: giver.name.split(' ')[0],
      friend: receiver.name,
      event: config.eventName,
      revealDate: config.revealDate,
      verse: config.verse,
      logoUrl: config.logoUrl,
    };

    const message = {
      to: giver.email,
      toName: giver.name,
      subject: buildSubject(context),
      text: buildText(context),
      html: buildHTML(context),
    };

    const prefix = `[${String(i + 1).padStart(3, ' ')}/${queue.length}]`;
    process.stdout.write(`${prefix} ${giver.name} <${giver.email}> ... `);

    const result = dryRun
      ? { ok: true, messageId: 'simulado', attempts: 0 }
      : await sendWithRetry(config, message);

    const record = {
      at: new Date().toISOString(),
      draw: drawFingerprint,
      name: giver.name,
      email: giver.email,
      status: result.ok ? (dryRun ? 'simulated' : 'sent') : 'failed',
      attempts: result.attempts,
      messageId: result.messageId ?? null,
      error: result.error ?? null,
    };
    results.push(record);

    if (!dryRun) await appendFile(logPath, JSON.stringify(record) + '\n', 'utf8');

    console.log(result.ok ? color.ok('OK') : color.error(`FALHA — ${result.error}`));

    if (!dryRun && i < queue.length - 1) await sleep(Number(config.sendIntervalMs || 700));
  }

  const sent = results.filter((r) => r.status === 'sent' || r.status === 'simulated');
  const failed = results.filter((r) => r.status === 'failed');

  return { total: pairs.length, skipped, sent, failed };
}

export function printSummary({ total, skipped, sent, failed }) {
  console.log(color.bold('\n─── RESUMO ───────────────────────────────'));
  console.log(`  Participantes ...... ${total}`);
  console.log(`  Já enviados antes .. ${skipped}`);
  console.log(color.ok(`  Enviados agora ..... ${sent.length}`));
  console.log(failed.length ? color.error(`  Falhas ............. ${failed.length}`)
                            : color.ok('  Falhas ............. 0'));

  if (failed.length) {
    console.log(color.error('\n  NÃO RECEBERAM:'));
    failed.forEach((f) => console.log(`    ✗ ${f.name} <${f.email}> — ${f.error}`));
    console.log(color.warn(
      '\n  Corrija o que for possível e rode "send --confirm" de novo.\n' +
      '  Quem já recebeu NÃO será reenviado.'
    ));
  } else {
    console.log(color.ok('\n  ✓ Todos os participantes foram notificados.'));
  }
  console.log(color.bold('──────────────────────────────────────────\n'));
}
