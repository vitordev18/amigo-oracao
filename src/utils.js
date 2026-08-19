export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

function detectDelimiter(firstLine) {
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons > commas ? ';' : ',';
}

export function parseCSV(text) {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delimiter = detectDelimiter(source.split('\n')[0] || '');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  return rows.slice(1).map((row) => {
    const record = {};
    header.forEach((key, i) => { record[key] = (row[i] ?? '').trim(); });
    return record;
  });
}

export function escapeHTML(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const color = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  error: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  info: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(token);
  }
  return args;
}
