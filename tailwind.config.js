// Konfigurasi Tailwind. Palet "brand" mengikuti kontrak K8 (nilai bawaan) tetapi dibaca dari CSS variable.
/** @type {import('tailwindcss').Config} */
export default {
  content: ['public/**/*.html', 'public/**/*.js'],
  theme: {
    extend: {
      colors: {
        // Nilai bawaan ada di src/tailwind.input.css (:root); /brand.css menimpanya per client.
        brand: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => [n, `rgb(var(--brand-${n}-rgb) / <alpha-value>)`])),
      },
    },
  },
  plugins: [],
};
