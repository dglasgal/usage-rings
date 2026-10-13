// The fun-mode pictures: animated SVG for the desktop app (drawn with
// `isInteractive` so SMIL animation runs), emoji and block glyphs for the terminal.

const FLAME = 'M12 2c1 3.5 4.5 5.5 4.5 10a6.5 6.5 0 0 1-13 0c0-2.6 1.3-4.4 2.6-5.6.2 1.7 1 2.8 2.2 3.4C8 6.5 10 4.5 12 2z'
const CORE = 'M12 10c.6 1.8 2.4 2.9 2.4 5.2a3.4 3.4 0 0 1-6.8 0c0-1.3.6-2.3 1.4-3 .2.9.6 1.4 1.2 1.7-.2-1.6.6-2.8 1.8-3.9z'

// One to three flames that flicker; faster and taller the hotter it is.
export function flamesSvg(level: number, height: number): string {
  const count = Math.max(1, Math.min(3, level))
  const width = Math.round(height * (0.75 + 0.55 * (count - 1)))
  const speed = [1.1, 0.8, 0.55][count - 1]
  const flames = Array.from({ length: count }, (_, i) => {
    const x = i * 13
    const scale = i === 1 ? 1 : 0.86
    const delay = (i * 0.17).toFixed(2)
    return [
      `<g transform="translate(${x} ${i === 1 ? 0 : 3}) scale(${scale})">`,
      `<g>`,
      `<animateTransform attributeName="transform" type="scale" values="1 1;1.06 0.9;0.95 1.08;1 1" dur="${speed}s" begin="-${delay}s" repeatCount="indefinite" additive="sum"/>`,
      `<path d="${FLAME}" fill="url(#burn)"/>`,
      `<path d="${CORE}" fill="#ffe680"><animate attributeName="opacity" values="0.95;0.6;1;0.95" dur="${speed}s" begin="-${delay}s" repeatCount="indefinite"/></path>`,
      `</g></g>`,
    ].join('')
  }).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${24 + 13 * (count - 1)} 24">`,
    '<defs><linearGradient id="burn" x1="0" y1="1" x2="0" y2="0">',
    '<stop offset="0" stop-color="#d7261e"/><stop offset="0.55" stop-color="#f26b1d"/><stop offset="1" stop-color="#ffb833"/>',
    '</linearGradient></defs>',
    flames,
    '</svg>',
  ].join('')
}

// A seeded sequence, so a drawing is the same each time it is drawn.
function seeded(seed: number) {
  let state = seed
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return state / 2_147_483_648
  }
}

const COIN =
  '<circle r="7" fill="#f5c542" stroke="#b8860b" stroke-width="1.4"/>' +
  '<text y="3.6" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="10" font-weight="700" fill="#8a6100">$</text>'
const BILL =
  '<rect x="-11" y="-6" width="22" height="12" rx="1.5" fill="#5fb36b" stroke="#2f7a3a" stroke-width="1"/>' +
  '<circle r="3.4" fill="none" stroke="#2f7a3a" stroke-width="0.9"/>' +
  '<text y="2.4" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-size="6" font-weight="700" fill="#1f5a2a">$</text>'

// Coins and bills falling across a strip; it plays twice and stops.
export function moneyRainSvg(width: number, height: number, seed = 7): string {
  const random = seeded(seed)
  const pieces = Math.max(10, Math.round(width / 28))
  const drops = Array.from({ length: pieces }, (_, i) => {
    const x = Math.round((i + 0.5) * (width / pieces) + (random() - 0.5) * 16)
    const delay = (random() * 1.6).toFixed(2)
    const dur = (1.2 + random() * 1.1).toFixed(2)
    const spin = random() > 0.5 ? 360 : -360
    const shape = random() > 0.6 ? BILL : COIN
    return [
      `<g transform="translate(${x} -16)">`,
      `<animateTransform attributeName="transform" type="translate" values="${x} -16;${x} ${height + 16}" dur="${dur}s" begin="${delay}s" repeatCount="2" fill="freeze"/>`,
      `<g><animateTransform attributeName="transform" type="rotate" values="0;${spin}" dur="${dur}s" begin="${delay}s" repeatCount="2"/>${shape}</g>`,
      '</g>',
    ].join('')
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${drops}</svg>`
}

// Bars for spend over time; the highest bar is labelled with its amount.
export function barsSvg(values: readonly number[], width: number, height: number, labels: readonly string[]): string {
  const max = Math.max(...values, 0.01)
  const gap = 2
  const bar = (width - gap * (values.length - 1)) / values.length
  const chartHeight = height - 14
  const top = values.indexOf(Math.max(...values))
  const bars = values
    .map((value, i) => {
      const h = Math.max(value > 0 ? 2 : 0, (value / max) * (chartHeight - 12))
      const x = i * (bar + gap)
      const share = value / max
      const color = share > 0.75 ? '#e2553d' : share > 0.4 ? '#f0a23a' : '#4caf7d'
      return `<rect x="${x.toFixed(1)}" y="${(chartHeight - h).toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${color}"><title>${labels[i] ?? ''}: $${value.toFixed(2)}</title></rect>`
    })
    .join('')
  const ticks = labels
    .map((label, i) =>
      label === ''
        ? ''
        : `<text x="${(i * (bar + gap) + bar / 2).toFixed(1)}" y="${height - 2}" text-anchor="middle" font-size="9" fill="#8a8a8a" font-family="-apple-system, system-ui, sans-serif">${label}</text>`,
    )
    .join('')
  const peak =
    values[top] !== undefined && values[top] > 0
      ? `<text x="${Math.min(width - 2, top * (bar + gap) + bar / 2).toFixed(1)}" y="9" text-anchor="middle" font-size="9" font-weight="600" fill="#8a8a8a" font-family="-apple-system, system-ui, sans-serif">$${values[top].toFixed(0)}</text>`
      : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${bars}${ticks}${peak}</svg>`
}

// The terminal's chart: one block glyph per value.
export function sparkline(values: readonly number[]): string {
  const glyphs = '▁▂▃▄▅▆▇█'
  const max = Math.max(...values, 0.01)
  return values.map(value => (value <= 0 ? ' ' : (glyphs[Math.min(7, Math.floor((value / max) * 7.999))] ?? '▁'))).join('')
}

export function fireEmoji(level: number): string {
  return level <= 0 ? '' : '🔥'.repeat(Math.min(3, level))
}
