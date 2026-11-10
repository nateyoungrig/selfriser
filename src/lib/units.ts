// Feet-inch parsing and formatting. Everything internal is inches.

/**
 * Display precision: lengths round to 1/displayDenom inch unless a caller asks otherwise.
 * 1 = nearest inch (the default; Settings offers finer), 8 = eighths.
 */
export let displayDenom = 1
export function setDisplayDenom(denom: number) {
  displayDenom = denom
}

const UNICODE_FRACTIONS: Record<string, string> = {
  '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4',
  '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8',
}

/** "3", "3.5", "1/2", "3 1/2" -> number, else null. */
function parseMixed(text: string): number | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || tokens.length > 2) return null
  let total = 0
  for (const [i, tok] of tokens.entries()) {
    const frac = /^(\d+)\/(\d+)$/.exec(tok)
    if (frac) {
      if (i !== tokens.length - 1 || Number(frac[2]) === 0) return null
      total += Number(frac[1]) / Number(frac[2])
    } else if (/^(\d+\.?\d*|\.\d+)$/.test(tok)) {
      if (i !== 0) return null
      total += Number(tok)
    } else return null
  }
  return total
}

/**
 * Parse a tape-measure style entry into inches.
 *   12'3 1/2"   12' 3.5   12-3 1/2   12 3 1/2   147"   147in   12.5'
 * A bare number (no marks) reads as feet when it is <= bareMaxFeet, otherwise as inches.
 */
export function parseLength(input: string, bareMaxFeet = 100): number | null {
  let s = input.trim().toLowerCase()
  if (!s || s.startsWith('-')) return null
  s = s.replace(/[’‘′`]/g, "'").replace(/[”“″]/g, '"').replace(/''/g, '"')
  s = s.replace(/[¼½¾⅛⅜⅝⅞]/g, (c) => UNICODE_FRACTIONS[c])
  s = s.replace(/\s*(feet|foot|ft)\.?\s*/g, "' ").replace(/\s*(inches|inch|in)\.?\s*$/g, '"')

  if (s.includes("'")) {
    const [feetText, ...rest] = s.split("'")
    if (rest.length !== 1) return null
    const feet = parseMixed(feetText)
    const inchText = rest[0].replace(/"$/, '').replace(/^[\s-]+/, '')
    const inches = inchText.trim() ? parseMixed(inchText) : 0
    if (feet === null || inches === null) return null
    return feet * 12 + inches
  }

  if (s.endsWith('"')) return parseMixed(s.slice(0, -1))

  const tokens = s.split(/[\s-]+/).filter(Boolean)
  const isFraction = (t: string) => t.includes('/')
  if (tokens.length === 1 || (tokens.length === 2 && isFraction(tokens[1]))) {
    const value = parseMixed(tokens.join(' '))
    if (value === null) return null
    return value <= bareMaxFeet ? value * 12 : value
  }
  if (tokens.length === 2 || (tokens.length === 3 && isFraction(tokens[2]))) {
    const feet = parseMixed(tokens[0])
    const inches = parseMixed(tokens.slice(1).join(' '))
    if (feet === null || inches === null) return null
    return feet * 12 + inches
  }
  return null
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Whole + reduced fraction of a non-negative number, rounded to 1/denom. */
function splitFraction(value: number, denom: number): { whole: number; num: number; den: number } {
  const ticks = Math.round(value * denom)
  const whole = Math.floor(ticks / denom)
  const num = ticks - whole * denom
  const g = num ? gcd(num, denom) : 1
  return { whole, num: num / g, den: denom / g }
}

/** 280.5 -> 23'-4 1/2" */
export function formatLength(inches: number, denom = displayDenom): string {
  const sign = inches < 0 ? '-' : ''
  const { whole, num, den } = splitFraction(Math.abs(inches), denom)
  const feet = Math.floor(whole / 12)
  const inch = whole - feet * 12
  const frac = num ? ` ${num}/${den}` : ''
  return `${sign}${feet}'-${inch}${frac}"`
}

/** Signed inches for deviations: 2.25 -> +2 1/4" */
export function formatDelta(inches: number, denom = displayDenom): string {
  const { whole, num, den } = splitFraction(Math.abs(inches), denom)
  if (whole === 0 && num === 0) return '0"'
  const sign = inches < 0 ? '-' : '+'
  const body = num ? (whole ? `${whole} ${num}/${den}` : `${num}/${den}`) : `${whole}`
  return `${sign}${body}"`
}

const GLYPHS: Record<string, string> = { '1/8': '⅛', '1/4': '¼', '3/8': '⅜', '1/2': '½', '5/8': '⅝', '3/4': '¾', '7/8': '⅞' }

/** Tight form for small cells: 280.5 -> 23' 4½" */
export function formatCompact(inches: number, denom = displayDenom): string {
  return formatLength(inches, denom).replace("'-", "' ").replace(/ (\d\/\d)"/, (_, f: string) => `${GLYPHS[f] ?? ' ' + f}"`)
}

export function formatDeltaCompact(inches: number, denom = displayDenom): string {
  return formatDelta(inches, denom).replace(/ ?(\d\/\d)"/, (_, f: string) => `${GLYPHS[f] ?? f}"`)
}

/** Tower load for a card: kips on a real roof (12.4k), pounds on the tabletop model (0.62 lb). */
export function formatLoad(lb: number): string {
  if (lb >= 1000) return `${(lb / 1000).toFixed(1)}k`
  return lb >= 10 ? `${Math.round(lb)} lb` : `${lb.toFixed(2)} lb`
}

/** Whole-roof total: 130 kips, or 1.9 lb for the model. */
export function formatTotalLoad(lb: number): string {
  return lb >= 1000 ? `${(lb / 1000).toFixed(0)} kips` : `${lb.toFixed(1)} lb`
}
