interface Props {
  title: string
  message: string
  action?: { label: string; onClick: () => void }
}

/** Shared empty/zero-data placeholder so no view ever renders a blank screen. */
export default function EmptyState({ title, message, action }: Props) {
  return (
    <div role="status" className="flex flex-col items-center text-center py-16 px-6">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-base-200 text-base-content/30">
        <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM10 9l5 3-5 3V9z" />
        </svg>
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-base-content/60">{message}</p>
      {action && (
        <button onClick={action.onClick} className="btn btn-primary btn-sm mt-5">
          {action.label}
        </button>
      )}
    </div>
  )
}
