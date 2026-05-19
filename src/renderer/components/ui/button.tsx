import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-fg-onAccent hover:bg-accent-emphasis shadow-sm',
        secondary:
          'bg-canvas-inset text-fg border border-border-muted hover:bg-canvas-subtle hover:border-border',
        ghost: 'text-fg-muted hover:bg-canvas-subtle hover:text-fg',
        danger: 'bg-danger text-fg-onAccent hover:bg-danger-emphasis shadow-sm',
        outline:
          'border border-border-muted bg-transparent text-fg hover:bg-canvas-subtle hover:border-border'
      },
      size: {
        sm: 'h-7 px-2.5 text-2xs',
        md: 'h-9 px-3.5',
        lg: 'h-10 px-5',
        icon: 'h-8 w-8'
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
