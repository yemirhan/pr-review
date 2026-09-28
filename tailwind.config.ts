import type { Config } from 'tailwindcss';

/**
 * Color tokens are exposed as `rgb(var(--c-name) / <alpha-value>)` so
 * Tailwind's opacity modifiers (`/30`, `/40`, etc.) keep working and so
 * the same class names produce different colors depending on the theme
 * variables defined in theme.css.
 */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;
/** Fixed-alpha helper for the `*-subtle` tokens. Tailwind only substitutes
 *  `<alpha-value>` when we use it; here we want a constant 0.15 tint, so we
 *  emit a literal rgb() expression that references the base CSS variable.
 */
const tint = (name: string, alpha: number) => `rgb(var(--c-${name}) / ${alpha})`;

const config: Config = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: v('canvas'),
          inset: v('canvas-inset'),
          subtle: v('canvas-subtle'),
          overlay: v('canvas-overlay')
        },
        border: {
          DEFAULT: v('border'),
          muted: v('border-muted'),
          subtle: v('border-subtle')
        },
        fg: {
          DEFAULT: v('fg'),
          muted: v('fg-muted'),
          subtle: v('fg-subtle'),
          onAccent: v('fg-onAccent')
        },
        accent: {
          DEFAULT: v('accent'),
          emphasis: v('accent-emphasis'),
          subtle: tint('accent-subtle', 0.12)
        },
        success: {
          DEFAULT: v('success'),
          emphasis: v('success-emphasis'),
          subtle: tint('success-subtle', 0.15)
        },
        danger: {
          DEFAULT: v('danger'),
          emphasis: v('danger-emphasis'),
          subtle: tint('danger-subtle', 0.15)
        },
        attention: {
          DEFAULT: v('attention'),
          emphasis: v('attention-emphasis'),
          subtle: tint('attention-subtle', 0.15)
        },
        diff: {
          addBg: tint('diff-addBg', 0.08),
          addLine: tint('diff-addLine', 0.2),
          delBg: tint('diff-delBg', 0.08),
          delLine: tint('diff-delLine', 0.2),
          gutter: v('diff-gutter')
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Inter"',
          'system-ui',
          'sans-serif'
        ],
        mono: [
          '"JetBrains Mono Variable"',
          '"SF Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace'
        ]
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['13px', { lineHeight: '18px' }],
        base: ['13px', { lineHeight: '20px' }],
        lg: ['15px', { lineHeight: '22px' }],
        xl: ['17px', { lineHeight: '24px' }]
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.2, 0, 0, 1)'
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { transform: 'translateY(6px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' }
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 160ms ease-out',
        shimmer: 'shimmer 1.6s linear infinite'
      }
    }
  }
};

export default config;
