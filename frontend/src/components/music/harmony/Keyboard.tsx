import { NOTE } from './scales'

const WHITE = [0, 2, 4, 5, 7, 9, 11]
const BLACK = [1, 3, 6, 8, 10]

/**
 * One octave of keys in SVG. `notes` are lit; `home` is ringed; `other` is a second scale to compare:
 * keys in both are solid, keys in only one are lighter and tagged A or B.
 */
export default function Keyboard({ notes, home, other, width = 300 }: {
  notes: readonly number[]
  home?: number
  other?: readonly number[]
  width?: number
}) {
  const kw = width / 7
  const h = 56
  const state = (pc: number) => {
    const a = notes.includes(pc)
    const b = !!other?.includes(pc)
    return other ? (a && b ? 'both' : a ? 'a' : b ? 'b' : '') : a ? 'both' : ''
  }
  const key = (pc: number, x: number, w: number, kh: number, black: boolean) => {
    const s = state(pc)
    return (
      <g key={pc}>
        <rect
          x={x} y={0.5} width={w} height={kh} rx={3}
          fill={s ? 'var(--color-primary)' : black ? '#2a333b' : '#d9e2e8'}
          fillOpacity={s === 'both' ? 0.9 : s ? 0.45 : black ? 1 : 0.12}
          stroke={pc === home ? '#fff' : black ? '#0b141d' : 'none'} strokeWidth={pc === home ? 2 : 1}
        />
        {(s === 'a' || s === 'b') && (
          <text x={x + w / 2} y={kh - 6} fontSize={10} fontWeight={700} textAnchor="middle" fill="currentColor">{s.toUpperCase()}</text>
        )}
      </g>
    )
  }
  return (
    <svg role="img" aria-label="Keys of the scale" viewBox={`0 0 ${width} ${h + 18}`} width="100%" style={{ maxWidth: width }}>
      {WHITE.map((pc, i) => key(pc, i * kw + 0.5, kw - 1, h, false))}
      {BLACK.map(pc => key(pc, (WHITE.indexOf(pc - 1) + 1) * kw - kw * 0.3, kw * 0.6, h * 0.6, true))}
      {WHITE.map((pc, i) => (
        <text key={pc} x={i * kw + kw / 2} y={h + 13} fontSize={10} textAnchor="middle" fill="currentColor" fillOpacity={0.6}>{NOTE[pc]}</text>
      ))}
    </svg>
  )
}
