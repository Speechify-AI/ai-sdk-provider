/** `<prosody rate>` accepts -50% to +9900%, so speed is bounded to 0.5x..100x. */
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 100;

// Mirrors the API's own test for SSML input, so both sides agree on what is markup.
const SPEAK_OPEN_AT_START = /^<speak(\s[^>]*)?>/;
const SPEAK_CLOSE = '</speak>';

export function isSSML(text: string): boolean {
  const trimmed = text.trim();
  return SPEAK_OPEN_AT_START.test(trimmed) && trimmed.endsWith(SPEAK_CLOSE);
}

/**
 * Applies a speed multiplier as an SSML `<prosody rate>` around the input.
 * Plain text is escaped and wrapped; SSML input gets the prosody element
 * inside its own `<speak>` root. `speed` must already be within bounds.
 */
export function withSpeechRate(text: string, speed: number): string {
  const percent = Math.round((speed - 1) * 10000) / 100;
  if (percent === 0) return text;
  const rate = `${percent > 0 ? '+' : ''}${percent}%`;

  if (isSSML(text)) {
    const trimmed = text.trim();
    const open = (trimmed.match(SPEAK_OPEN_AT_START) as RegExpMatchArray)[0];
    const inner = trimmed.slice(open.length, trimmed.length - SPEAK_CLOSE.length);
    return `${open}<prosody rate="${rate}">${inner}</prosody>${SPEAK_CLOSE}`;
  }
  return `<speak><prosody rate="${rate}">${escapeXmlText(text)}</prosody>${SPEAK_CLOSE}`;
}

// A character XML cannot carry becomes a space, as the API does for plain text,
// so speech-mark offsets still index the caller's text one for one.
export function escapeXmlText(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if (char === '&') out += '&amp;';
    else if (char === '<') out += '&lt;';
    else if (char === '>') out += '&gt;';
    else if (isXmlChar(code)) out += char;
    else out += ' ';
  }
  return out;
}

function isXmlChar(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}
