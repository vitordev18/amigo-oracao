import { draw, drawStructure, shuffle } from '../src/draw.js';

let failures = 0;
const check = (label, condition) => {
  console.log(`${condition ? '  \x1b[32m✓\x1b[0m' : '  \x1b[31m✗\x1b[0m'} ${label}`);
  if (!condition) failures++;
};

const people = (n, exclusions = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}@x.com`, name: `Pessoa ${i}`, email: `p${i}@x.com`,
    exclude: exclusions[i] || [],
  }));

console.log('\n1) Invariantes em 5.000 sorteios (n de 2 a 60), modo cycle');
{
  let noFixedPoint = true, bijective = true, complete = true;
  for (let t = 0; t < 5000; t++) {
    const n = 2 + (t % 59);
    const { pairs } = draw(people(n), { mode: 'cycle' });
    const gave = new Set(), received = new Set();
    for (const { giver, receiver } of pairs) {
      if (giver.id === receiver.id) noFixedPoint = false;
      gave.add(giver.id); received.add(receiver.id);
    }
    if (gave.size !== n || received.size !== n) bijective = false;
    if (pairs.length !== n) complete = false;
  }
  check('Ninguém tirou a si mesmo (A ≠ A)', noFixedPoint);
  check('Cada pessoa tira 1 e é tirada por 1 (bijeção)', bijective);
  check('Nenhum participante ficou de fora ou duplicado', complete);
}

console.log('\n2) Invariantes em 5.000 sorteios, modo free');
{
  let ok = true;
  for (let t = 0; t < 5000; t++) {
    const n = 2 + (t % 59);
    const { pairs } = draw(people(n), { mode: 'free' });
    const received = new Set(pairs.map((p) => p.receiver.id));
    if (pairs.some((p) => p.giver.id === p.receiver.id) || received.size !== n) ok = false;
  }
  check('Desarranjo válido em todas as execuções', ok);
}

console.log('\n3) Modo cycle forma uma única roda (sem pares recíprocos)');
{
  const { pairs } = draw(people(30), { mode: 'cycle' });
  const s = drawStructure(pairs);
  check(`Exatamente 1 ciclo de tamanho 30 (obtido: ${s.cycleSizes.join(',')})`,
    s.totalCycles === 1 && s.cycleSizes[0] === 30);
  check(`Zero pares A↔B (obtido: ${s.mutualPairs})`, s.mutualPairs === 0);
}

console.log('\n4) Restrições respeitadas em 2.000 sorteios');
{
  const exclusions = { 0: ['p1@x.com'], 1: ['p0@x.com'], 2: ['p3@x.com'],
                       3: ['p2@x.com'], 4: ['p5@x.com'], 5: ['p4@x.com'] };
  let ok = true;
  for (let t = 0; t < 2000; t++) {
    const { pairs } = draw(people(20, exclusions), { mode: 'cycle' });
    for (const { giver, receiver } of pairs) {
      if ((exclusions[Number(giver.id.match(/\d+/)[0])] || []).includes(receiver.id)) ok = false;
    }
  }
  check('Nenhuma restrição violada', ok);
}

console.log('\n5) Restrição impossível falha de forma explícita');
{
  const ids = Array.from({ length: 4 }, (_, i) => `p${i}@x.com`);
  const impossible = ids.map((id) => ({ id, name: id, email: id, exclude: ids.filter((o) => o !== id) }));
  let threw = false;
  try { draw(impossible, { maxAttempts: 300 }); } catch { threw = true; }
  check('Erro claro em vez de resultado inválido', threw);
}

console.log('\n6) Uniformidade do embaralhamento (n=6, 60.000 amostras)');
{
  const freq = new Map();
  for (let t = 0; t < 60000; t++) {
    const key = shuffle([0, 1, 2, 3, 4, 5]).join('');
    freq.set(key, (freq.get(key) || 0) + 1);
  }
  const expected = 60000 / 720;
  const chi = [...freq.values()].reduce((s, o) => s + (o - expected) ** 2 / expected, 0);
  check(`Todas as 720 permutações aparecem (obtido: ${freq.size})`, freq.size === 720);
  check(`Qui-quadrado ${chi.toFixed(1)} dentro do esperado (< 800)`, chi < 800);
}

console.log(failures === 0
  ? '\n\x1b[32m✓ Todos os testes passaram.\x1b[0m\n'
  : `\n\x1b[31m✗ ${failures} teste(s) falharam.\x1b[0m\n`);
process.exit(failures === 0 ? 0 : 1);
