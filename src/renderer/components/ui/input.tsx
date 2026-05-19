import * as React from 'react';
import { cn } from '../../lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-border-muted bg-canvas-inset px-3 py-1.5 text-sm text-fg shadow-sm transition-colors',
        'placeholder:text-fg-subtle',
        'hover:border-border focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
