import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border text-[13px] font-medium leading-none transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-accent-emphasis text-fg-onAccent enabled:hover:brightness-110',
        secondary: 'border-border bg-canvas-subtle text-fg enabled:hover:bg-border-muted',
        ghost:
          'border-transparent bg-transparent text-fg-muted enabled:hover:bg-canvas-subtle enabled:hover:text-fg',
        danger:
          'border-border bg-canvas-subtle text-danger enabled:hover:border-danger/40 enabled:hover:bg-danger/10',
        outline: 'border-border bg-transparent text-fg enabled:hover:bg-canvas-subtle'
      },
      size: {
        sm: 'h-6 px-2 text-xs',
        md: 'h-7 px-3',
        lg: 'h-8 px-3.5',
        icon: 'h-7 w-7 px-0'
      }
    },
    defaultVariants: { variant: 'secondary', size: 'md' }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
);
Button.displayName = 'Button';

export { buttonVariants };
