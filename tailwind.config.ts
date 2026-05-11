import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // GitHub dark palette (Primer)
        canvas: {
          DEFAULT: '#0d1117',
          inset: '#010409',
          subtle: '#161b22',
          overlay: '#1c2128'
        },
        border: {
          DEFAULT: '#30363d',
          muted: '#21262d',
          subtle: '#1b1f23'
        },
        fg: {
          DEFAULT: '#e6edf3',
          muted: '#8b949e',
          subtle: '#6e7681',
          onAccent: '#ffffff'
        },
        accent: {
          DEFAULT: '#2f81f7',
          emphasis: '#1f6feb',
          subtle: 'rgba(56,139,253,0.15)'
        },
        success: {
          DEFAULT: '#3fb950',
          emphasis: '#238636',
          subtle: 'rgba(46,160,67,0.15)'
        },
        danger: {
          DEFAULT: '#f85149',
          emphasis: '#da3633',
          subtle: 'rgba(248,81,73,0.15)'
        },
        attention: {
          DEFAULT: '#d29922',
          emphasis: '#9e6a03',
          subtle: 'rgba(187,128,9,0.15)'
        },
        diff: {
          addBg: 'rgba(46,160,67,0.15)',
          addLine: 'rgba(46,160,67,0.30)',
          delBg: 'rgba(248,81,73,0.10)',
          delLine: 'rgba(248,81,73,0.25)',
          gutter: '#0d1117'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Helvetica',
          'Arial',
          'sans-serif'
        ],
        mono: [
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
        '2xs': '11px',
        xs: '12px',
        sm: '13px',
        base: '14px'
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { transform: 'translateY(6px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        }
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'slide-up': 'slide-up 160ms ease-out'
      }
    }
  }
};

export default config;
