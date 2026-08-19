import { promises as dns } from 'node:dns';
import { readFile } from 'node:fs/promises';
import { color, csvToObjects } from './utils.js';

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

const SUSPICIOUS_DOMAINS = {
  'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gmail.con': 'gmail.com', 'gnail.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'hotmil.com': 'hotmail.com', 'outlok.com': 'outlook.com', 'outllok.com': 'outlook.com',
  'yaho.com': 'yahoo.com', 'yahho.com': 'yahoo.com', 'iclod.com': 'icloud.com',
  'bol.com': 'bol.com.br', 'uol.com': 'uol.com.br', 'terra.com': 'terra.com.br',
};

export async function loadParticipants(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const rows = csvToObjects(raw);

  const errors = [];
  const warnings = [];
  const participants = [];
  const seen = new Map();

  if (rows.length === 0) errors.push('O arquivo CSV está vazio ou só tem cabeçalho.');

  rows.forEach((row, index) => {
    const lineNumber = index + 2;
    const name = (row.name ?? row.nome ?? '').replace(/\s+/g, ' ').trim();
    const email = (row.email ?? '').trim().toLowerCase();

    if (!name) { errors.push(`Linha ${lineNumber}: nome vazio.`); return; }
    if (!email) { errors.push(`Linha ${lineNumber}: e-mail vazio (${name}).`); return; }
    if (!EMAIL_PATTERN.test(email)) {
      errors.push(`Linha ${lineNumber}: e-mail inválido "${email}" (${name}).`); return;
    }

    const domain = email.split('@')[1];
    if (SUSPICIOUS_DOMAINS[domain]) {
      errors.push(`Linha ${lineNumber}: domínio "${domain}" parece erro de digitação. ` +
                  `Você quis dizer "${SUSPICIOUS_DOMAINS[domain]}"? (${name})`);
      return;
    }

    if (seen.has(email)) {
      errors.push(`Linha ${lineNumber}: e-mail duplicado "${email}" ` +
                  `(já usado na linha ${seen.get(email)}).`);
      return;
    }
    seen.set(email, lineNumber);

    const exclude = (row.exclude ?? row.excluir ?? '')
      .split(/[|,;]/).map((value) => value.trim().toLowerCase()).filter(Boolean);

    participants.push({ id: email, name, email, exclude });
  });

  const knownIds = new Set(participants.map((p) => p.id));
  for (const participant of participants) {
    for (const target of participant.exclude) {
      if (!knownIds.has(target)) {
        warnings.push(`Restrição ignorada: "${target}" (de ${participant.name}) não está na lista.`);
      }
    }
    participant.exclude = participant.exclude
      .filter((target) => knownIds.has(target) && target !== participant.id);
  }

  if (participants.length === 1) errors.push('Só há 1 participante válido — impossível sortear.');
  if (participants.length === 2) {
    warnings.push('Com apenas 2 participantes o resultado é óbvio (cada um tira o outro).');
  }

  return { participants, errors, warnings };
}

export async function checkMX(participants) {
  const domains = [...new Set(participants.map((p) => p.email.split('@')[1]))];
  const status = new Map();

  await Promise.all(domains.map(async (domain) => {
    try {
      const records = await dns.resolveMx(domain);
      if (records.length > 0) return status.set(domain, { ok: true });
    } catch (err) {
      if (!['ENODATA', 'ENOTFOUND'].includes(err.code)) {
        return status.set(domain, { inconclusive: true, reason: err.code || 'falha de DNS' });
      }
    }
    try {
      await dns.resolve(domain);
      status.set(domain, { ok: true, implicit: true });
    } catch {
      status.set(domain, { ok: false });
    }
  }));

  const warnings = [];
  for (const participant of participants) {
    const result = status.get(participant.email.split('@')[1]);
    if (result?.ok) continue;
    warnings.push(result?.inconclusive
      ? `${participant.name} <${participant.email}> — não foi possível consultar o DNS ` +
        `(${result.reason}). Verificação inconclusiva: o e-mail pode estar correto.`
      : `${participant.name} <${participant.email}> — o domínio não parece receber e-mail ` +
        '(sem MX e sem registro A).');
  }
  return warnings;
}

export function printValidation({ participants, errors, warnings }) {
  console.log(color.bold(`\nParticipantes válidos: ${participants.length}`));
  if (warnings.length) {
    console.log(color.warn(`\nAvisos (${warnings.length}):`));
    warnings.forEach((w) => console.log('  • ' + w));
  }
  if (errors.length) {
    console.log(color.error(`\nErros bloqueantes (${errors.length}):`));
    errors.forEach((e) => console.log('  ✗ ' + e));
  } else {
    console.log(color.ok('\n✓ Nenhum erro bloqueante encontrado.'));
  }
}
