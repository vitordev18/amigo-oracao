import { createHash, randomInt } from 'node:crypto';

export function shuffle(list) {
  const items = [...list];
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function buildForbiddenMap(participants) {
  const forbidden = new Map(participants.map((p) => [p.id, new Set()]));
  for (const participant of participants) {
    for (const target of participant.exclude || []) {
      forbidden.get(participant.id).add(target);
      forbidden.get(target)?.add(participant.id);
    }
  }
  return forbidden;
}

function drawAsCycle(participants) {
  const order = shuffle(participants);
  return order.map((person, i) => ({ giver: person, receiver: order[(i + 1) % order.length] }));
}

function drawAsFree(participants) {
  const receivers = shuffle(participants);
  return participants.map((person, i) => ({ giver: person, receiver: receivers[i] }));
}

function pairsAreValid(pairs, forbidden) {
  return pairs.every(({ giver, receiver }) =>
    giver.id !== receiver.id && !forbidden.get(giver.id).has(receiver.id));
}

export function draw(participants, { mode = 'cycle', maxAttempts = 20000 } = {}) {
  if (participants.length < 2) {
    throw new Error('São necessários ao menos 2 participantes para sortear.');
  }
  const forbidden = buildForbiddenMap(participants);
  const generate = mode === 'free' ? drawAsFree : drawAsCycle;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const pairs = generate(participants);
    if (pairsAreValid(pairs, forbidden)) {
      verifyDraw(pairs, participants, forbidden);
      return { pairs, attempts: attempt, mode };
    }
  }

  throw new Error(
    `Não foi possível satisfazer as restrições em ${maxAttempts} tentativas.\n` +
    'Isso normalmente indica restrições impossíveis (ex.: um grupo de exclusão ' +
    'com metade ou mais dos participantes). Revise a coluna "excluir" do CSV.'
  );
}

export function verifyDraw(pairs, participants, forbidden = new Map()) {
  const total = participants.length;
  const ids = new Set(participants.map((p) => p.id));
  const gave = new Set();
  const received = new Set();

  if (pairs.length !== total) {
    throw new Error(`Integridade: ${pairs.length} pares para ${total} participantes.`);
  }

  for (const { giver, receiver } of pairs) {
    if (!ids.has(giver.id) || !ids.has(receiver.id)) {
      throw new Error('Integridade: id fora da lista.');
    }
    if (giver.id === receiver.id) {
      throw new Error(`Integridade: ${giver.name} tirou a si mesmo.`);
    }
    if (gave.has(giver.id)) {
      throw new Error(`Integridade: ${giver.name} tirou mais de uma pessoa.`);
    }
    if (received.has(receiver.id)) {
      throw new Error(`Integridade: ${receiver.name} foi tirado 2x.`);
    }
    if (forbidden.get(giver.id)?.has(receiver.id)) {
      throw new Error(`Integridade: restrição violada (${giver.name} → ${receiver.name}).`);
    }
    gave.add(giver.id);
    received.add(receiver.id);
  }

  if (gave.size !== total) throw new Error('Integridade: alguém ficou sem sortear.');
  if (received.size !== total) throw new Error('Integridade: alguém ficou sem ser sorteado.');
  return true;
}

export function drawStructure(pairs) {
  const next = new Map(pairs.map(({ giver, receiver }) => [giver.id, receiver.id]));
  const visited = new Set();
  const cycles = [];

  for (const id of next.keys()) {
    if (visited.has(id)) continue;
    let length = 0;
    let current = id;
    while (!visited.has(current)) {
      visited.add(current);
      current = next.get(current);
      length++;
    }
    cycles.push(length);
  }

  const mutualPairs = pairs
    .filter(({ giver, receiver }) => next.get(receiver.id) === giver.id).length / 2;

  return {
    totalCycles: cycles.length,
    cycleSizes: cycles.sort((a, b) => b - a),
    mutualPairs,
  };
}

export function fingerprint(pairs) {
  const canonical = pairs
    .map(({ giver, receiver }) => `${giver.email}|${giver.name}>${receiver.email}|${receiver.name}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
