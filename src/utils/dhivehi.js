const { HttpError } = require('./http-error');

// Dhivehi (Thaana) text on printed documents. Screens stay English; a document carries Dhivehi
// only where someone has entered it.

const THAANA_LETTER = /[ހ-ޥޱ]/;
const FILI = /[ަ-ް]/; // vowel signs and sukun, drawn on the letter before them
const LTR_CHAR = /[A-Za-z0-9]/;
const MIRRORED = { '(': ')', ')': '(', '[': ']', ']': '[', '<': '>', '>': '<' };

function hasThaana(value) {
  return THAANA_LETTER.test(String(value || ''));
}

// A Dhivehi field from a request: empty means "none" (null); otherwise it must contain Thaana, so
// English typed into the Dhivehi box by mistake is refused instead of printed.
function cleanDhivehi(value, label, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (!hasThaana(text)) throw new HttpError(400, `${label} must be written in Dhivehi (Thaana).`);
  if (text.length > max) throw new HttpError(400, `${label} is too long (at most ${max} characters).`);
  return text;
}

// The PDF library lays text out left to right. This returns the string in the order it has to be
// drawn for it to read right to left: the letters reversed, each keeping its vowel sign, while a
// run of digits or Latin letters inside it (a number, a date) keeps its own order.
function visualOrder(text) {
  const chars = [...String(text || '')];
  const units = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (LTR_CHAR.test(c)) {
      let run = c;
      while (i + 1 < chars.length && (LTR_CHAR.test(chars[i + 1]) || (/[.,:/-]/.test(chars[i + 1]) && LTR_CHAR.test(chars[i + 2] || '')))) run += chars[++i];
      units.push(run);
    } else if (FILI.test(c) && units.length) {
      units[units.length - 1] += c;
    } else {
      units.push(MIRRORED[c] || c);
    }
  }
  return units.reverse().join('');
}

module.exports = { hasThaana, cleanDhivehi, visualOrder };
