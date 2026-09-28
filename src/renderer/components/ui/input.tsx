import * as React from 'react';
import { cn } from '../../lib/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-7 w-full rounded-md border border-border bg-canvas px-2.5 text-[13px] text-fg transition-colors duration-100',
        'placeholder:text-fg-subtle',
        'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';
