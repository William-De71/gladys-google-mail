// -----------------------------------------------------------------------------
// Building the RFC 2822 / MIME message that users.messages.send expects in
// its `raw` field (base64url), and reading the headers Gmail returns.
//
// - Header values are stripped of CR/LF (no header injection from a scene
//   field) and non-ASCII values are RFC 2047 encoded-words (UTF-8, base64).
// - Bodies are UTF-8, base64 encoded (lines of 76 characters).
// - text           -> text/plain
//   html           -> multipart/alternative (plain text version + HTML)
//   + image file   -> multipart/mixed (the above + the image as attachment)
// - No From header: Gmail sets the address of the connected account.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

// Gmail accepts at most 500 recipients per message.
const MAX_RECIPIENTS = 500;
const ADDRESS = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;

/** An invalid input (address, empty message): never retried. */
class MailInputError extends Error {
  /**
   * @param {string} message - The message.
   * @param {string} code - `invalid_address`, `no_recipient`, `empty`, `too_many`.
   */
  constructor(message, code) {
    super(message);
    this.name = 'MailInputError';
    this.code = code;
  }
}

const oneLine = (value) =>
  String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();

/**
 * @description Split and check a list of addresses ("a@b.c, d@e.f; Name <g@h.i>").
 * @param {unknown} raw - The text typed by the user.
 * @returns {string[]} The bare addresses, lower-cased domain kept as typed.
 * @example
 * parseAddresses('a@b.fr; Bob <c@d.fr>'); // -> ['a@b.fr', 'c@d.fr']
 */
function parseAddresses(raw) {
  const text = oneLine(raw);
  if (!text) {
    return [];
  }
  return text
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const bracket = /<([^<>]+)>\s*$/.exec(part);
      const address = (bracket ? bracket[1] : part).trim();
      if (!ADDRESS.test(address)) {
        throw new MailInputError(
          `Invalid email address: ${address.slice(0, 80)}`,
          'invalid_address',
        );
      }
      return address;
    });
}

/**
 * @description An RFC 2047 encoded-word when the value is not plain ASCII.
 * @param {string} value - The header value.
 * @returns {string} The encoded value.
 * @example
 * encodeHeader('Été'); // -> '=?UTF-8?B?w4l0w6k=?='
 */
function encodeHeader(value) {
  const text = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(text)) {
    return text;
  }
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

const base64Lines = (buffer) => buffer.toString('base64').replace(/.{1,76}/g, '$&\r\n');

/**
 * @description A crude plain text version of a simple HTML body.
 * @param {string} html - The HTML.
 * @returns {string} The text.
 * @example
 * htmlToText('<p>Hello<br>world</p>'); // -> 'Hello\nworld'
 */
function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @description The type of an image given as base64 (the `file` of a Gladys
 * message), from its first bytes.
 * @param {string} base64 - The image, raw base64 or a data: URI.
 * @returns {{ type: string, extension: string, data: Buffer }|null} The image, or null.
 */
function readImage(base64) {
  if (typeof base64 !== 'string' || base64.length === 0) {
    return null;
  }
  const data = Buffer.from(base64.replace(/^data:[^,]*,/, ''), 'base64');
  if (data.length < 4) {
    return null;
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    return { type: 'image/jpeg', extension: 'jpg', data };
  }
  if (data.subarray(0, 4).toString('hex') === '89504e47') {
    return { type: 'image/png', extension: 'png', data };
  }
  if (data.subarray(0, 4).toString('latin1') === 'RIFF') {
    return { type: 'image/webp', extension: 'webp', data };
  }
  return null;
}

const boundary = () => `gladys_${randomBytes(12).toString('hex')}`;

/**
 * @description A text part.
 * @param {string} type - text/plain or text/html.
 * @param {string} text - The content.
 * @returns {string} The part (headers + body).
 */
const textPart = (type, text) =>
  `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(
    Buffer.from(String(text).replace(/\r?\n/g, '\r\n'), 'utf8'),
  )}`;

/**
 * @description Build the raw message for users.messages.send.
 * @param {object} mail - `{ to, cc, bcc, subject, text, html, image }`: `to`,
 *   `cc`, `bcc` as typed by the user; `html` true = `text` is simple HTML;
 *   `image` an optional base64 image attached.
 * @returns {{ raw: string, recipients: number }} The base64url message.
 * @example
 * buildRawMessage({ to: 'a@b.fr', subject: 'Hi', text: 'Hello' }).raw;
 */
function buildRawMessage({ to, cc, bcc, subject, text, html = false, image = null }) {
  const lists = { To: parseAddresses(to), Cc: parseAddresses(cc), Bcc: parseAddresses(bcc) };
  const recipients = lists.To.length + lists.Cc.length + lists.Bcc.length;
  if (lists.To.length === 0) {
    throw new MailInputError('A mail needs at least one recipient', 'no_recipient');
  }
  if (recipients > MAX_RECIPIENTS) {
    throw new MailInputError('Gmail accepts at most 500 recipients', 'too_many');
  }
  const body = String(text ?? '');
  const file = readImage(image);
  if (!body.trim() && !file) {
    throw new MailInputError('The mail is empty', 'empty');
  }
  const headers = ['MIME-Version: 1.0'];
  for (const [name, addresses] of Object.entries(lists)) {
    if (addresses.length > 0) {
      headers.push(`${name}: ${addresses.join(', ')}`);
    }
  }
  headers.push(`Subject: ${encodeHeader(subject)}`);

  let content;
  if (html) {
    const alternative = boundary();
    content = [
      `Content-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n`,
      `--${alternative}\r\n${textPart('text/plain', htmlToText(body))}`,
      `--${alternative}\r\n${textPart('text/html', body)}`,
      `--${alternative}--\r\n`,
    ].join('');
  } else {
    content = textPart('text/plain', body);
  }
  if (file) {
    const mixed = boundary();
    const name = `image.${file.extension}`;
    content = [
      `Content-Type: multipart/mixed; boundary="${mixed}"\r\n\r\n`,
      `--${mixed}\r\n${content}`,
      `--${mixed}\r\nContent-Type: ${file.type}; name="${name}"\r\n`,
      `Content-Disposition: attachment; filename="${name}"\r\n`,
      `Content-Transfer-Encoding: base64\r\n\r\n${base64Lines(file.data)}`,
      `--${mixed}--\r\n`,
    ].join('');
  }
  const message = `${headers.join('\r\n')}\r\n${content}`;
  return { raw: Buffer.from(message, 'utf8').toString('base64url'), recipients };
}

/**
 * @description Decode the RFC 2047 encoded-words of a header Gmail returned
 * (Gmail usually decodes them already).
 * @param {string} value - The header value.
 * @returns {string} The decoded value.
 */
function decodeHeader(value) {
  return String(value ?? '').replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g,
    (match, charset, encoding, data) => {
      try {
        const bytes =
          encoding.toUpperCase() === 'B'
            ? Buffer.from(data, 'base64')
            : Buffer.from(
                data
                  .replace(/_/g, ' ')
                  .replace(/=([0-9a-f]{2})/gi, (m, hex) => String.fromCharCode(parseInt(hex, 16))),
                'latin1',
              );
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return match;
      }
    },
  );
}

/**
 * @description Split a From header into a name and an address.
 * @param {string} header - `"Name" <a@b.c>` or `a@b.c`.
 * @returns {{ name: string, address: string }} The parts (address lower-cased).
 * @example
 * parseFrom('"EDF" <Factures@edf.fr>'); // -> { name: 'EDF', address: 'factures@edf.fr' }
 */
function parseFrom(header) {
  const text = decodeHeader(header).trim();
  const match = /^(.*?)\s*<([^<>]+)>\s*$/.exec(text);
  if (match) {
    const name = match[1].replace(/^"(.*)"$/, '$1').trim();
    const address = match[2].trim().toLowerCase();
    return { name: name || address, address };
  }
  return { name: text, address: text.toLowerCase() };
}

export {
  MAX_RECIPIENTS,
  MailInputError,
  parseAddresses,
  encodeHeader,
  htmlToText,
  readImage,
  buildRawMessage,
  decodeHeader,
  parseFrom,
};
