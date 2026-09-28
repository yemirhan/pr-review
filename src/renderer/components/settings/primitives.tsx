import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Building blocks for every settings page, so they all read the same way:
 * a page title, then groups of rows with the label on the left and the
 * control on the right.
 */

export function Page({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-8 pb-16 pt-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-fg">{title}</h1>
          {description && <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="space-y-7">{children}</div>
    </div>
  );
}

/** A titled card of rows. */
export function Group({
  title,
  description,
  action,
  children,
  flush
}: {
  title?: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  /** Children draw their own dividers (lists). */
  flush?: boolean;
}) {
  return (
    <section>
      {(title || action) && (
        <div className="mb-2 flex items-end gap-3 px-1">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[13px] font-medium text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-2xs leading-relaxed text-fg-subtle">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          'overflow-hidden rounded-lg border border-border-muted bg-canvas-subtle/30',
          !flush && 'divide-y divide-border-muted'
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Label + description on the left, control on the right. */
export function Row({
  label,
  description,
  children,
  htmlFor,
  align = 'center'
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  htmlFor?: string;
  align?: 'center' | 'start';
}) {
  return (
    <div className={cn('flex min-h-[52px] gap-6 px-4 py-3', align === 'center' ? 'items-center' : 'items-start')}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-[13px] text-fg">
          {label}
        </label>
        {description && <div className="mt-0.5 text-2xs leading-relaxed text-fg-subtle">{description}</div>}
      </div>
      {children != null && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  id,
  disabled
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50',
        checked ? 'border-transparent bg-accent-emphasis' : 'border-transparent bg-fg-subtle/35'
      )}
    >
      <span
        className={cn(
          'block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[15px]' : 'translate-x-[1px]'
        )}
      />
    </button>
  );
}

export type StatusTone = 'ok' | 'error' | 'warn' | 'off';

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        tone === 'ok' && 'bg-success',
        tone === 'error' && 'bg-danger',
        tone === 'warn' && 'bg-attention',
        tone === 'off' && 'bg-fg-subtle/40',
        className
      )}
    />
  );
}

/** A row that opens to show more rows (per-repo configuration). */
export function Disclosure({
  title,
  meta,
  children,
  defaultOpen = false,
  disabled
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        className="flex min-h-[48px] w-full items-center gap-2.5 px-4 text-left hover:bg-canvas-subtle/60 disabled:cursor-default disabled:hover:bg-transparent"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform',
            open && 'rotate-90',
            disabled && 'opacity-0'
          )}
        />
        <span className="text-[13px] text-fg">{title}</span>
        {meta && <span className="flex min-w-0 flex-1 items-center gap-2 text-2xs text-fg-subtle">{meta}</span>}
      </button>
      {open && !disabled && <div className="border-t border-border-muted bg-canvas/40">{children}</div>}
    </div>
  );
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
