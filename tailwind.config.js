// Konfigurasi Tailwind. Palet "brand" mengikuti kontrak K8.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['public/**/*.html', 'public/**/*.js'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7fe',
          100: '#d9eefc',
          200: '#b5defa',
          300: '#75c5f5',
          400: '#3f9fe6',
          500: '#1d6fcf',
          600: '#0f50b0',
          700: '#0b3f98',
          800: '#083284',
          900: '#062567',
        },
      },
    },
  },
  plugins: [],
};
