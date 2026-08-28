/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Neon Caramel / Liquid Copper / Roasted Amber palette
        caramel: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24', // Golden Amber
          500: '#e28743', // Signature Neon Caramel / Roasted Copper
          600: '#c86b29',
          700: '#9a4b18', // Deep Burnt Caramel (Light mode high-contrast)
          800: '#78350f',
          900: '#451a03',
          950: '#260d01',
        },
        // Cyber Espresso & Warm Roast Palette
        espresso: {
          950: '#000000', // Pitch Black OLED
          900: '#120d0a', // Dark Roast Glass
          850: '#18120e',
          800: '#221a14',
          700: '#33271f',
          600: '#4d3b30',
          500: '#6e5546',
          400: '#947663',
          300: '#bda391',
          200: '#dfd2c8',
          100: '#f2ece7',
          50: '#fcfaf7', // Warm Cream Canvas
        },
        // Hazelnut & Latte accents
        hazelnut: {
          300: '#e5b281',
          400: '#d4a373',
          500: '#c58f59',
          600: '#a36d38',
        }
      },
      animation: {
        'pulse-glow': 'pulseGlow 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 15px -2px rgba(226, 135, 67, 0.3)' },
          '50%': { boxShadow: '0 0 30px 4px rgba(226, 135, 67, 0.6)' },
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
