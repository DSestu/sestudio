/** A small sparkle marking a choice whose result AI makes up — here, frames
 *  drawn between the real ones. Styled inline, as it may sit inside the
 *  player's own menus, whose rules would otherwise reshape it. */
export default function AiBadge({ waiting }: {
  /** The AI frames are not on screen yet: the source's rate plays meanwhile. */
  waiting?: boolean
}) {
  return (
    <span
      role="img"
      aria-label={waiting ? 'AI frames on their way' : 'Frames drawn by AI'}
      title={waiting
        ? 'Playing the original frame rate until the AI frames are ready'
        : 'Frames in between drawn by AI'}
      className={waiting ? 'animate-pulse' : undefined}
      style={{
        opacity: waiting ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        borderRadius: 999,
        background: 'linear-gradient(135deg, #7c3aed, #db2777)',
        color: '#fff',
        flexShrink: 0,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11 2l1.8 5.2L18 9l-5.2 1.8L11 16l-1.8-5.2L4 9l5.2-1.8zM18.5 13l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"
        />
      </svg>
    </span>
  )
}
