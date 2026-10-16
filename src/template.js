import { escapeHTML } from './utils.js';

const BRAND = {
  red: '#E4001B',
  redDark: '#B00016',
  orange: '#F5731E',
  orangeSoft: '#F5A03C',
  paper: '#FBF3EF',
  card: '#FFFFFF',
  ink: '#2B2320',
  inkSoft: '#6B5A54',
  inkFaint: '#9A857D',
  nameBg: '#FFF4F0',
  secretBg: '#FFF3E6',
  secretInk: '#8A3D0A',
  hairline: '#F0DED6',
};

const INTRO =
  'Separe um tempo para orar por essa pessoa no secreto: pela vida, pela família e pelo ministério dela. ' +
  'O propósito é crescermos em intimidade e união como ministério, cuidando uns dos outros em oração.';

const LETTER =
  'Se o seu coração desejar, prepare uma carta ou uma palavra do coração para entregar ao seu amigo ' +
  'oração no dia da revelação. Não é obrigatório: o mais importante é a oração.';

export function buildSubject({ name, event }) {
  return `${name}, chegou o resultado do ${event} 🙏`;
}

export function buildText({ name, friend, revealDate, revealClock, verse }) {
  return [
    `Olá, ${name}!`,
    '',
    'A pessoa que você vai apresentar a Deus em oração, no secreto, é:',
    '',
    `>>> ${friend} <<<`,
    '',
    INTRO,
    '',
    LETTER,
    revealDate ? '' : null,
    revealDate
      ? `Ore até a revelação, em ${revealDate}${revealClock ? ` às ${revealClock}` : ''}. ` +
        'Até lá, guarde segredo! 🤫'
      : null,
    verse ? '' : null,
    verse ? `"${verse}"` : null,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

export function buildHTML({ name, friend, event, revealDate, revealClock, verse, logoUrl }) {
  const e = escapeHTML;
  const b = BRAND;

  const logoBlock = logoUrl
    ? `<tr><td align="center" style="padding:0 0 14px;">
        <img src="${e(logoUrl)}" width="72" height="72" alt="${e(event)}"
             style="display:block;border:0;outline:none;text-decoration:none;
                    width:72px;height:72px;border-radius:50%;background:#ffffff;">
      </td></tr>`
    : '';

  const revealBlock = revealDate
    ? `<tr><td style="padding:0 32px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:${b.secretBg};border-radius:10px;">
          <tr>
            <td width="5" style="background:${b.orange};font-size:0;line-height:0;">&nbsp;</td>
            <td style="padding:14px 18px;font-size:15px;line-height:1.6;color:${b.secretInk};">
              🤫 <strong>Guarde segredo!</strong> Ore até a revelação, em
              <strong>${e(revealDate)}</strong>${revealClock ? ` às <strong>${e(revealClock)}</strong>` : ''}.
            </td>
          </tr>
        </table>
      </td></tr>`
    : '';

  const verseBlock = verse
    ? `<tr><td style="padding:0 32px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="border-top:1px solid ${b.hairline};padding:20px 8px 0;">
            <p style="margin:0;font-size:15px;line-height:1.7;color:${b.inkSoft};
                      font-style:italic;text-align:center;">
              &ldquo;${e(verse)}&rdquo;
            </p>
          </td></tr>
        </table>
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${e(event)}</title>
</head>
<body style="margin:0;padding:0;background:${b.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">
  O resultado do sorteio chegou. Guarde segredo até a revelação.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:${b.paper};padding:30px 12px;">
  <tr><td align="center">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="max-width:560px;background:${b.card};border-radius:16px;overflow:hidden;
                  font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
                  box-shadow:0 3px 16px rgba(180,0,24,.10);">

      <tr><td align="center"
              style="background-color:${b.red};
                     background-image:linear-gradient(135deg,${b.red} 0%,${b.orange} 100%);
                     padding:30px 28px 26px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
          ${logoBlock}
          <tr><td align="center">
            <p style="margin:0;color:#FFE6DC;font-size:12px;letter-spacing:2.5px;
                      text-transform:uppercase;font-weight:600;">
              ${e(event)}
            </p>
            <h1 style="margin:8px 0 0;color:#ffffff;font-size:25px;font-weight:700;line-height:1.25;">
              O sorteio foi realizado 🙏
            </h1>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:32px 32px 6px;">
        <p style="margin:0 0 18px;font-size:17px;line-height:1.6;color:${b.ink};">
          Olá, <strong>${e(name)}</strong>!
        </p>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:${b.ink};">
          A pessoa que você vai apresentar a Deus em oração, no secreto, é:
        </p>
      </td></tr>

      <tr><td style="padding:0 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="background:${b.nameBg};border:2px dashed ${b.orangeSoft};border-radius:14px;">
          <tr><td align="center" style="padding:28px 18px;">
            <p style="margin:0;font-size:27px;font-weight:700;color:${b.redDark};line-height:1.3;">
              ${e(friend)}
            </p>
          </td></tr>
        </table>
      </td></tr>

      <tr><td style="padding:26px 32px 22px;">
        <p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${b.ink};">
          ${e(INTRO)}
        </p>
        <p style="margin:0;font-size:16px;line-height:1.65;color:${b.ink};">
          ${e(LETTER)}
        </p>
      </td></tr>

      ${revealBlock}
      ${verseBlock}

      <tr><td style="background:${b.paper};padding:18px 32px;text-align:center;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${b.inkFaint};">
          Enviado automaticamente e de forma confidencial &middot; ${e(event)}
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}
