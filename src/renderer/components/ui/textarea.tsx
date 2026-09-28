import * as React from 'react';
import { cn } from '../../lib/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-border bg-canvas px-2.5 py-1.5 text-[13px] leading-5 text-fg transition-colors duration-100',
        'placeholder:text-fg-subtle resize-y',
        'focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/25',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';
