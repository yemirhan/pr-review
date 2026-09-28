import { cn } from '../../lib/cn';

/**
 * Animated placeholder block. Uses a faint shimmer gradient layered on top of
 * a translucent fill so it reads on both the light and dark themes.
 */
export function Skeleton({
  className,
  style
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        'relative overflow-hidden rounded bg-fg/[0.06] skeleton-shimmer',
        className
      )}
      aria-hidden
    />
  );
}
