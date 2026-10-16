#!/usr/bin/env node
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { loadParticipants, checkMX, printValidation } from './participants.js';
import { draw, verifyDraw, drawStructure, fingerprint } from './draw.js';
import { sendAll, saveDraw, readLog, printSummary } from './dispatch.js';
import { sendWithRetry } from './mailer.js';
import { buildSubject, buildText, buildHTML } from './template.js';
import { parseArgs, color, env } from './utils.js';

const ROOT = path.resolve(import.meta.dirname, '..');

function resolveParticipantsFile() {
  const fromEnv = env('PARTICIPANTS_FILE', 'ARQUIVO_PARTICIPANTES');
  if (fromEnv) return path.resolve(ROOT, fromEnv);
  for (const candidate of ['participants.csv', 'participantes.csv']) {
    const full = path.join(ROOT, candidate);
    if (existsSync(full)) return full;
  }
  return path.join(ROOT, 'participants.csv');
}

const PARTICIPANTS_FILE = resolveParticipantsFile();
const DRAW_FILE = path.join(ROOT, 'output', 'draw.json');
const LOG_FILE = path.join(ROOT, 'output', 'sends.jsonl');
const PREVIEW_FILE = path.join(ROOT, 'previa-email.html');

function loadConfig({ requireCredentials = true } = {}) {
  const config = {
    provider: (env('PROVIDER', 'PROVEDOR') || 'brevo').toLowerCase(),
    brevoApiKey: env('BREVO_API_KEY'),
    resendApiKey: env('RESEND_API_KEY'),
    smtpHost: env('SMTP_HOST'),
    smtpPort: env('SMTP_PORT'),
    smtpUser: env('SMTP_USER'),
    smtpPass: env('SMTP_PASS'),
    senderName: env('SENDER_NAME', 'REMETENTE_NOME') || 'Amigo Oração',
    senderEmail: env('SENDER_EMAIL', 'REMETENTE_EMAIL'),
    replyTo: env('REPLY_TO', 'RESPONDER_PARA') || '',
    eventName: env('EVENT_NAME', 'EVENTO_NOME') || 'Amigo Oração',
    revealDate: (env('REVEAL_DATE', 'DATA_REVELACAO') || '').trim(),
    revealClock: (env('REVEAL_CLOCK', 'HORARIO_REVELACAO') || '').trim(),
    verse: env('VERSE', 'VERSICULO') || '',
    logoUrl: env('LOGO_URL') || '',
    drawMode: (env('DRAW_MODE', 'MODO_SORTEIO') || 'cycle').toLowerCase(),
    sendIntervalMs: Number(env('SEND_INTERVAL_MS', 'INTERVALO_MS') || 700),
    maxSendAttempts: Number(env('MAX_SEND_ATTEMPTS', 'MAX_TENTATIVAS_ENVIO') || 4),
  };

  if (config.drawMode === 'ciclo') config.drawMode = 'cycle';
  if (config.drawMode === 'livre') config.drawMode = 'free';

  if (requireCredentials) {
    const missing = [];
    if (!config.senderEmail) missing.push('SENDER_EMAIL');
    if (config.provider === 'brevo' && !config.brevoApiKey) missing.push('BREVO_API_KEY');
    if (config.provider === 'resend' && !config.resendApiKey) missing.push('RESEND_API_KEY');
    if (config.provider === 'smtp' && (!config.smtpHost || !config.smtpUser)) {
      missing.push('SMTP_HOST/SMTP_USER');
    }
    if (missing.length) {
      console.error(color.error(`\n✗ Faltam variáveis no .env: ${missing.join(', ')}\n`));
      process.exit(1);
    }
  }
  return config;
}

async function loadOrExit() {
  if (!existsSync(PARTICIPANTS_FILE)) {
    console.error(color.error(`\n✗ Arquivo não encontrado: ${PARTICIPANTS_FILE}\n`));
    process.exit(1);
  }
  return loadParticipants(PARTICIPANTS_FILE);
}

async function cmdValidate(args) {
  const result = await loadOrExit();
  if (args.mx) {
    console.log(color.dim('Consultando registros MX dos domínios...'));
    const mxWarnings = await checkMX(result.participants);
    mxWarnings.forEach((w) => result.warnings.push(w));
  }
  printValidation(result);
  if (result.errors.length) process.exit(1);
}

function sampleContext(config) {
  return {
    name: 'Ana',
    friend: 'João Carlos da Silva',
    event: config.eventName,
    revealDate: config.revealDate,
    revealClock: config.revealClock,
    verse: config.verse,
    logoUrl: config.logoUrl,
  };
}

async function cmdPreview() {
  const config = loadConfig({ requireCredentials: false });
  const context = sampleContext(config);
  await writeFile(PREVIEW_FILE, buildHTML(context));

  console.log(color.bold('\nASSUNTO\n'));
  console.log(`  ${buildSubject(context)}`);
  console.log(color.bold('\nVERSÃO EM TEXTO\n'));
  console.log(buildText(context).split('\n').map((line) => `  ${line}`).join('\n'));
  console.log(color.ok(`\n✓ Prévia HTML gravada em ${PREVIEW_FILE}`));
  if (!config.logoUrl) {
    console.log(color.dim('  LOGO_URL vazio: o cabeçalho sai sem logo, igual ao e-mail real.'));
  }
  console.log(color.dim('  Abra o arquivo no navegador para conferir.\n'));
}

async function cmdTest(args) {
  const config = loadConfig();
  const target = args.to || args.para;
  if (!target) {
    console.error(color.error('\n✗ Informe o destino: --to voce@email.com\n'));
    process.exit(1);
  }
  const context = sampleContext(config);
  console.log(color.info(`Enviando amostra para ${target} via ${config.provider}...`));
  const result = await sendWithRetry(config, {
    to: target,
    toName: 'Teste',
    subject: '[TESTE] ' + buildSubject(context),
    text: buildText(context),
    html: buildHTML(context),
  });
  console.log(result.ok
    ? color.ok(`✓ Enviado (id: ${result.messageId}). Confira a caixa de entrada E o spam.`)
    : color.error(`✗ Falhou: ${result.error}`));
  if (!result.ok) process.exit(1);
}

async function cmdDraw(args) {
  if (existsSync(DRAW_FILE) && !args.force) {
    console.error(color.warn(
      `\n⚠ Já existe um sorteio em ${DRAW_FILE}.\n` +
      '  Se e-mails já foram enviados, refazer o sorteio quebra a consistência.\n' +
      '  Para sobrescrever mesmo assim: draw --force\n'
    ));
    process.exit(1);
  }

  const { participants, errors } = await loadOrExit();
  if (errors.length) {
    console.error(color.error('\n✗ Corrija os erros da lista antes de sortear (rode: validate).\n'));
    errors.forEach((e) => console.error('  ✗ ' + e));
    process.exit(1);
  }

  const config = loadConfig({ requireCredentials: false });
  const { pairs, attempts, mode } = draw(participants, { mode: config.drawMode });
  const structure = drawStructure(pairs);
  const hash = fingerprint(pairs);

  await saveDraw(DRAW_FILE, {
    event: config.eventName,
    generatedAt: new Date().toISOString(),
    mode,
    attempts,
    fingerprint: hash,
    total: pairs.length,
    pairs: pairs.map(({ giver, receiver }) => ({
      giver: { name: giver.name, email: giver.email },
      receiver: { name: receiver.name, email: receiver.email },
    })),
  });

  console.log(color.ok('\n✓ Sorteio concluído e verificado.'));
  console.log(`  Participantes .......... ${pairs.length}`);
  console.log(`  Modo ................... ${mode}`);
  console.log(`  Tentativas ............. ${attempts}`);
  console.log(`  Ciclos ................. ${structure.totalCycles} ` +
              `(tamanhos: ${structure.cycleSizes.join(', ')})`);
  console.log(`  Pares recíprocos (A↔B) . ${structure.mutualPairs}`);
  console.log(`  Impressão digital ...... ${hash}`);
  console.log(color.ok('  ✓ Ninguém tirou a si mesmo, ninguém repetido, ninguém de fora.'));
  console.log(color.warn(`\n  Resultado gravado em ${DRAW_FILE}`));
  console.log(color.dim('  Não abra esse arquivo se quiser manter a sua própria surpresa.\n'));
}

async function cmdSend(args) {
  const config = loadConfig();
  if (!existsSync(DRAW_FILE)) {
    console.error(color.error('\n✗ Nenhum sorteio encontrado. Rode "draw" primeiro.\n'));
    process.exit(1);
  }

  const data = JSON.parse(await readFile(DRAW_FILE, 'utf8'));
  const pairs = data.pairs.map((pair) => ({
    giver: { ...pair.giver, id: pair.giver.email, exclude: [] },
    receiver: { ...pair.receiver, id: pair.receiver.email, exclude: [] },
  }));

  verifyDraw(pairs, pairs.map((p) => p.giver));
  if (fingerprint(pairs) !== data.fingerprint) {
    console.error(color.error('\n✗ A impressão digital não confere: draw.json foi alterado.\n'));
    process.exit(1);
  }

  const dryRun = !args.confirm;

  const current = await loadParticipants(PARTICIPANTS_FILE).catch(() => null);
  if (current) {
    const drawn = new Set(pairs.map((p) => p.giver.email));
    const listed = new Set(current.participants.map((p) => p.email));
    const added = [...listed].filter((email) => !drawn.has(email));
    const removed = [...drawn].filter((email) => !listed.has(email));

    if (added.length || removed.length) {
      console.error(color.error('\n✗ A lista de participantes mudou depois do sorteio:'));
      added.forEach((e) => console.error(color.error(`    + ${e} — está no CSV, mas não foi sorteado`)));
      removed.forEach((e) => console.error(color.error(`    − ${e} — foi sorteado, mas saiu do CSV`)));
      console.error(color.warn(
        '\n  Se NENHUM e-mail foi enviado ainda:\n' +
        '    node --env-file=.env src/cli.js draw --force\n\n' +
        '  Se JÁ houve envio, não refaça o sorteio — isso tornaria inconsistente\n' +
        '  o resultado de quem já recebeu. Rode "report" e trate caso a caso.\n'));
      process.exit(1);
    }
  }

  const summary = await sendAll({
    config, pairs, logPath: LOG_FILE, drawFingerprint: data.fingerprint, dryRun,
  });
  printSummary(summary);
  if (dryRun) {
    console.log(color.warn('Isso foi uma SIMULAÇÃO. Para enviar de verdade:'));
    console.log(color.bold('  node --env-file=.env src/cli.js send --confirm\n'));
  }
  if (summary.failed.length) process.exit(1);
}

async function cmdStatus() {
  const config = loadConfig({ requireCredentials: false });
  const steps = [];
  let next = null;

  let list = null;
  if (existsSync(PARTICIPANTS_FILE)) {
    list = await loadParticipants(PARTICIPANTS_FILE).catch(() => null);
  }
  if (!list) {
    steps.push(['Lista', false, `arquivo não encontrado (${path.basename(PARTICIPANTS_FILE)})`]);
    next = ['Crie o arquivo de participantes e valide:',
            'node --env-file=.env src/cli.js validate --mx'];
  } else if (list.errors.length) {
    steps.push(['Lista', false, `${list.errors.length} erro(s) bloqueante(s)`]);
    next = ['Corrija a lista e valide de novo:',
            'node --env-file=.env src/cli.js validate --mx'];
  } else {
    steps.push(['Lista', true, `${list.participants.length} participante(s) válido(s)`]);
  }

  const credentialKey = { brevo: config.brevoApiKey, resend: config.resendApiKey,
                          smtp: config.smtpHost }[config.provider];
  const configOk = Boolean(config.senderEmail && credentialKey);
  steps.push(['Configuração', configOk,
    configOk ? `provedor ${config.provider}, remetente ${config.senderEmail}`
             : 'faltam credenciais ou remetente no .env']);
  if (!next && !configOk) {
    next = ['Preencha o .env e mande uma amostra para você:',
            'node --env-file=.env src/cli.js test --to voce@email.com'];
  }

  let drawData = null;
  if (existsSync(DRAW_FILE)) {
    try {
      drawData = JSON.parse(await readFile(DRAW_FILE, 'utf8'));
    } catch {
      drawData = null;
    }
  }
  if (drawData) {
    const when = new Date(drawData.generatedAt).toLocaleString('pt-BR');
    steps.push(['Sorteio', true, `${drawData.total} pares selados em ${when}`]);
  } else {
    steps.push(['Sorteio', false, 'ainda não realizado']);
    if (!next) {
      next = ['Se já conferiu a amostra por e-mail, sorteie:',
              'node --env-file=.env src/cli.js draw'];
    }
  }

  const log = await readLog(LOG_FILE, { drawFingerprint: drawData?.fingerprint ?? null });
  const sent = [...log.values()].filter((r) => r.status === 'sent');
  const failed = [...log.values()].filter((r) => r.status === 'failed');

  if (log.size === 0) {
    steps.push(['Envio', false, 'nenhum envio registrado']);
    if (!next && drawData) {
      next = ['Simule o envio antes de disparar de verdade:',
              'node --env-file=.env src/cli.js send'];
    }
  } else if (failed.length) {
    steps.push(['Envio', false, `${sent.length} enviado(s), ${failed.length} com falha`]);
    if (!next) {
      next = ['Corrija as causas e reenvie apenas os pendentes:',
              'node --env-file=.env src/cli.js send --confirm'];
    }
  } else {
    const missing = drawData ? drawData.total - sent.length : 0;
    steps.push(['Envio', missing === 0, `${sent.length} enviado(s)` +
      (missing > 0 ? `, ${missing} ainda na fila` : '')]);
    if (!next) {
      next = missing > 0
        ? ['Faltam participantes na fila:', 'node --env-file=.env src/cli.js send --confirm']
        : ['Tudo enviado. Depois do evento, remova o arquivo que revela os pares:',
           `del ${DRAW_FILE}`];
    }
  }

  console.log(color.bold('\nETAPA ATUAL\n'));
  steps.forEach(([label, ok, detail], i) => {
    const mark = ok ? color.ok('✓') : color.warn('○');
    console.log(`  [${i + 1}] ${mark} ${label.padEnd(14, '.')} ${detail}`);
  });

  console.log(color.bold('\nPRÓXIMO PASSO\n'));
  console.log(`  ${next[0]}`);
  console.log(color.info(`  ${next[1]}\n`));
}

async function currentFingerprint() {
  if (!existsSync(DRAW_FILE)) return null;
  try {
    return JSON.parse(await readFile(DRAW_FILE, 'utf8')).fingerprint ?? null;
  } catch {
    return null;
  }
}

async function cmdReport() {
  const state = await readLog(LOG_FILE, { drawFingerprint: await currentFingerprint() });
  if (state.size === 0) {
    console.log(color.warn('\nNenhum envio registrado ainda.\n'));
    return;
  }
  const rows = [...state.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  console.log(color.bold('\nSTATUS DOS ENVIOS\n'));
  for (const row of rows) {
    const mark = row.status === 'sent' ? color.ok('✓') : color.error('✗');
    console.log(`  ${mark} ${row.name.padEnd(28)} ${row.email.padEnd(34)} ${row.status}` +
                (row.error ? color.error(`  — ${row.error}`) : ''));
  }
  const okCount = rows.filter((r) => r.status === 'sent').length;
  console.log(color.bold(
    `\n  Total: ${rows.length} | Entregues ao provedor: ${okCount} | Falhas: ${rows.length - okCount}\n`));
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

const COMMANDS = {
  status: cmdStatus,
  validate: cmdValidate,
  preview: cmdPreview,
  test: cmdTest,
  draw: cmdDraw,
  send: cmdSend,
  report: cmdReport,
};

if (!COMMANDS[command]) {
  console.log(`
${color.bold('Amigo Oração')} — sorteio e envio confidencial

  ${color.bold('Perdido? Rode isto primeiro:')}
  node --env-file=.env src/cli.js ${color.info('status')}     mostra a etapa atual e o próximo passo

  ${color.dim('Sequência completa:')}
  node --env-file=.env src/cli.js ${color.info('validate')} [--mx]              1. confere a lista
  node --env-file=.env src/cli.js ${color.info('preview')}                      2. prévia do e-mail (previa-email.html)
  node --env-file=.env src/cli.js ${color.info('test')} --to voce@email.com     3. amostra por e-mail
  node --env-file=.env src/cli.js ${color.info('draw')} [--force]               4. sorteia e sela
  node --env-file=.env src/cli.js ${color.info('send')}                         5. simula o envio
  node --env-file=.env src/cli.js ${color.info('send')} --confirm               6. envia de verdade
  node --env-file=.env src/cli.js ${color.info('report')}                       7. status por pessoa
`);
  process.exit(command ? 1 : 0);
}

try {
  await COMMANDS[command](args);
} catch (err) {
  console.error(color.error(`\n✗ ${err.message}\n`));
  process.exit(1);
}
