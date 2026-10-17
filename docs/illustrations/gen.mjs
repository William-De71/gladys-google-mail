// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// Made-up mails (fixed date: Saturday 17 October 2026, 10:00 in Paris),
// written in the language of each image, as a user would receive them.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildUnreadWidget, buildVacationWidget } = await load('src/widgets.js');
const { describeVacation, enableSettings } = await load('src/vacation.js');
const { LANGUAGES } = await load('src/i18n.js');
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

const NOW = Date.parse('2026-10-17T08:00:00Z');
const MINUTE = 60000;
const ZONE = 'Europe/Paris';

const MAILS = {
  en: [
    ['Energy supplier', 'Your October bill is available', 'Amount due: €42.18, paid on the 25th.'],
    ['Alice', 'Dinner on Saturday?', 'Shall we meet at 8 pm at our place?'],
    ['Parcel service', 'Your parcel arrives today', 'Delivery between 2 pm and 4 pm.'],
  ],
  fr: [
    [
      'Fournisseur d’énergie',
      'Votre facture d’octobre est disponible',
      'Montant : 42,18 €, prélevé le 25.',
    ],
    ['Alice', 'Dîner samedi ?', 'On se retrouve à 20 h chez nous ?'],
    ['Transporteur', 'Votre colis arrive aujourd’hui', 'Livraison entre 14 h et 16 h.'],
  ],
  de: [
    ['Energieversorger', 'Deine Oktoberrechnung ist da', 'Betrag: 42,18 €, Abbuchung am 25.'],
    ['Alice', 'Abendessen am Samstag?', 'Treffen wir uns um 20 Uhr bei uns?'],
    ['Paketdienst', 'Dein Paket kommt heute', 'Zustellung zwischen 14 und 16 Uhr.'],
  ],
  es: [
    [
      'Compañía eléctrica',
      'Tu factura de octubre ya está disponible',
      'Importe: 42,18 €, cargo el día 25.',
    ],
    ['Alice', '¿Cenamos el sábado?', '¿Quedamos a las 20 h en casa?'],
    ['Mensajería', 'Tu paquete llega hoy', 'Entrega entre las 14 h y las 16 h.'],
  ],
};
const VACATION = {
  en: ['Out of office', 'I am away until 26 October, with limited access to my mail.'],
  fr: ['Absent', 'Je suis absent jusqu’au 26 octobre, avec un accès limité à mes mails.'],
  de: ['Abwesend', 'Ich bin bis zum 26. Oktober abwesend und lese E-Mails nur selten.'],
  es: ['Fuera de la oficina', 'Estoy fuera hasta el 26 de octubre, con acceso limitado al correo.'],
};

const contents = {};
for (const language of LANGUAGES) {
  const mails = MAILS[language].map(([fromName, subject, snippet], index) => ({
    id: `m${index}`,
    threadId: `t${index}`,
    fromName,
    fromAddress: 'sender@example.com',
    subject,
    snippet,
    date: NOW - [12, 95, 260][index] * MINUTE,
    important: index === 0,
  }));
  const [subject, message] = VACATION[language];
  contents[language] = {
    unread: buildUnreadWidget({
      labelName: 'INBOX',
      count: 7,
      mails,
      account: 'home@example.com',
      canModify: true,
      language,
    }),
    vacation: buildVacationWidget({
      vacation: describeVacation(
        enableSettings({
          subject,
          message,
          start: Date.parse('2026-10-16T22:00:00Z'),
          end: Date.parse('2026-10-26T22:59:00Z'),
        }),
        NOW,
      ),
      language,
      zone: ZONE,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents, formValues: {} }));
