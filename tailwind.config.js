/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#05080c',
          900: '#0a0f16',
          800: '#0f1620',
          700: '#161f2c',
          600: '#1e2a3a',
          500: '#2a3a4d',
        },
        ice: {
          100: '#e8f4fb',
          200: '#cbe7f5',
          300: '#9fd4ea',
          400: '#6dbde0',
          accent: '#3fd7ff',
        },
        status: {
          normal: '#4ade80',
          warn: '#fbbf24',
          critical: '#f87171',
        },
      },
      boxShadow: {
        glow: '0 0 24px rgba(63, 215, 255, 0.25)',
      },
    },
  },
  plugins: [],
}
