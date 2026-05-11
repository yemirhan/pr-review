import type { ChecksRollup } from '@shared/types';

export function ChecksPill({
  checks,
  compact = false
}: {
  checks: ChecksRollup;
  compact?: boolean;
}) {
  if (checks.total === 0) return null;
  const { state, passed, failed, pending, total } = checks;
  const color =
    state === 'SUCCESS'
      ? 'text-success border-success/30'
      : state === 'FAILURE'
        ? 'text-danger border-danger/30'
        : state === 'PENDING'
          ? 'text-attention border-attention/30'
          : 'text-fg-subtle border-border-muted';
  const icon =
    state === 'SUCCESS' ? '●' : state === 'FAILURE' ? '✕' : state === 'PENDING' ? '◔' : '○';
  return (
    <span
      className={`chip ${color}`}
      title={`${passed} passed, ${failed} failed, ${pending} pending`}
    >
      <span>{icon}</span>
      {compact ? (
        <span>
          {state === 'SUCCESS'
            ? `${total}`
            : state === 'FAILURE'
              ? `${failed}/${total}`
              : `${passed}/${total}`}
        </span>
      ) : (
        <span>
          {passed}/{total} checks
        </span>
      )}
    </span>
  );
}
