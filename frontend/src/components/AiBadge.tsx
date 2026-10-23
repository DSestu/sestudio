/** "AI" in a small gradient pill, for a choice whose result AI makes up.
 *  Styled inline: it sits inside vidstack's menus, whose own rules would
 *  otherwise stack the mark over the word. */
export default function AiBadge() {
  return (
    <span
      title="Frames in between drawn by AI"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        marginLeft: 'auto',
        padding: '1px 7px 1px 5px',
        borderRadius: 999,
        background: 'linear-gradient(135deg, #7c3aed, #db2777)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M11 2l1.8 5.2L18 9l-5.2 1.8L11 16l-1.8-5.2L4 9l5.2-1.8zM18.5 13l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"
        />
      </svg>
      AI
    </span>
  )
}
