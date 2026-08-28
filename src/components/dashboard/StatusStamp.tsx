interface StampProps {
  status: string | null;
  dueDate: string | null;
}

// Maps a filing's status (and, for open filings, whether it's overdue)
// to the stamp's tier, letter, and accessible label.
function resolveStamp(status: string | null, dueDate: string | null) {
  if (!status) {
    return { tier: 'neutral' as const, letter: '—', label: 'No filing on record' };
  }
  if (status === 'filed' || status === 'approved') {
    return { tier: 'good' as const, letter: 'F', label: `Filed` };
  }
  const isOverdue = dueDate ? new Date(dueDate) < new Date(new Date().toDateString()) : false;
  if (isOverdue) {
    return { tier: 'bad' as const, letter: '!', label: `Overdue — due ${dueDate}` };
  }
  const letters: Record<string, string> = {
    pending: 'P',
    docs_requested: 'D',
    in_progress: 'I',
    under_review: 'R',
  };
  return { tier: 'warn' as const, letter: letters[status] ?? '·', label: status.replace('_', ' ') };
}

export function StatusStamp({ status, dueDate }: StampProps) {
  const { tier, letter, label } = resolveStamp(status, dueDate);
  return (
    <span className={`stamp stamp--${tier}`} title={label} aria-label={label}>
      {letter}
    </span>
  );
}
