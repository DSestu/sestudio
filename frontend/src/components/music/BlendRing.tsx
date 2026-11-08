import { blendWord } from '../../blend'

/** Green, amber, red: blends well, fairly, roughly. */
export const blendColor = (s: number) => (s >= 0.75 ? 'oklch(76% .17 155)' : s >= 0.5 ? 'oklch(82% .11 75)' : 'oklch(70% .17 25)')

/** How well a join blends (SPEC-blend story 8): a ring filled to the score, coloured by its word. */
export function BlendRing({ score, size = 18 }: { score: number; size?: number }) {
  const r = size / 2 - 2.5, c = 2 * Math.PI * r, m = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Blends ${blendWord(score)}, ${Math.round(score * 100)} of 100`} className="shrink-0">
      <circle cx={m} cy={m} r={r} fill="none" stroke="oklch(92% .01 240 / .14)" strokeWidth={3} />
      <circle cx={m} cy={m} r={r} fill="none" stroke={blendColor(score)} strokeWidth={3} strokeLinecap="round"
        strokeDasharray={`${score * c} ${c}`} transform={`rotate(-90 ${m} ${m})`} />
    </svg>
  )
}
