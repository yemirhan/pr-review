import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  label?: string;
}

const SIZE: Record<NonNullable<SpinnerProps['size']>, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5'
};

export function Spinner({ size = 'sm', className, label }: SpinnerProps) {
  return (
    <Loader2
      className={cn('animate-spin text-fg-subtle', SIZE[size], className)}
      aria-label={label ?? 'Loading'}
      role="status"
    />
  );
}

export function SpinnerInline({
  label,
  size = 'sm',
  className
}: {
  label: string;
  size?: SpinnerProps['size'];
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-fg-muted', className)}>
      <Spinner size={size} />
      <span className="text-xs">{label}</span>
    </span>
  );
}

export function SpinnerOverlay({ label }: { label?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-fg-muted animate-fade-in">
      <Spinner size="lg" className="text-fg-subtle" />
      {label && <span className="text-xs text-fg-subtle">{label}</span>}
    </div>
  );
}
