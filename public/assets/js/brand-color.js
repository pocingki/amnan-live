// Warna brand: validasi satu warna utama dan turunan palet 50-900 (murni, tanpa dependensi).
// Warna utama menjadi shade 800 (warna judul, tombol, lencana); shade lain diturunkan darinya.
// Palet bawaan (K8) dipakai bila warna kosong.

export const DEFAULT_PALETTE = {
  50: '#eef7fe', 100: '#d9eefc', 200: '#b5defa', 300: '#75c5f5', 400: '#3f9fe6',
  500: '#1d6fcf', 600: '#0f50b0', 700: '#0b3f98', 800: '#083284', 900: '#062567',
};
export const SHADES = Object.keys(DEFAULT_PALETTE).map(Number);
export const MIN_CONTRAST = 4.5; // WCAG AA untuk teks putih di atas warna utama

/** '#RGB' / '#RRGGBB' / tanpa '#', huruf besar-kecil -> '#rrggbb', atau null bila tidak valid. */
export function normalizeHex(v) {
  const s = String(v ?? '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return '#' + [...s].map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(s)) return '#' + s;
  return null;
}

export const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = ([r, g, b]) => '#' + [r, g, b].map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

function hslToRgb([h, s, l]) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** Rasio kontras warna dengan putih (1-21). */
export const contrastWithWhite = (hex) => 1.05 / (luminance(hexToRgb(hex)) + 0.05);

/**
 * Pesan galat bila warna tidak boleh dipakai sebagai warna utama, atau null bila boleh.
 * Teks putih harus terbaca di atasnya (tombol, lencana), jadi warna yang terlalu terang ditolak.
 */
export function checkBase(v) {
  const hex = normalizeHex(v);
  if (!hex) return 'Warna brand harus berformat #RRGGBB, contoh #0b5fa5.';
  if (contrastWithWhite(hex) < MIN_CONTRAST) return 'Warna terlalu terang: teks putih di atas warna ini sulit dibaca. Pilih warna yang lebih gelap.';
  return null;
}

// Posisi shade 700..300 di antara lightness shade 800 (0) dan shade 200 (1), diambil dari palet bawaan.
const T = { 700: 0.07, 600: 0.16, 500: 0.32, 400: 0.53, 300: 0.75 };
const L_FIXED = { 200: 85, 100: 92, 50: 96 };

/** Palet 50-900 dari warna utama (= shade 800). Warna tidak valid -> palet bawaan. */
export function paletteFrom(v) {
  const base = normalizeHex(v);
  if (!base) return { ...DEFAULT_PALETTE };
  const [h, s, l] = rgbToHsl(hexToRgb(base));
  const at = (L, sat = s) => rgbToHex(hslToRgb([h, sat, Math.max(0, Math.min(100, L))]));
  const out = { 800: base, 900: at(l * 0.75) };
  for (const [k, t] of Object.entries(T)) out[k] = at(l + (L_FIXED[200] - l) * t);
  for (const [k, L] of Object.entries(L_FIXED)) out[k] = at(Math.max(L, l + 2));
  return Object.fromEntries(SHADES.map((k) => [k, out[k]]));
}

/** CSS yang menimpa variabel warna (dimuat setelah tailwind.css dan style.css). Kosong = bawaan. */
export function cssFor(v) {
  const base = normalizeHex(v);
  if (!base) return '/* warna brand: bawaan */\n';
  const p = paletteFrom(base);
  const rgb = SHADES.map((k) => `  --brand-${k}-rgb: ${hexToRgb(p[k]).join(' ')};`).join('\n');
  return `/* warna brand: ${base} */\n:root {\n${rgb}\n  --brand: ${p[800]};\n  --brand-dark: ${p[900]};\n  --brand-50: ${p[50]};\n  --brand-100: ${p[100]};\n  --brand-300: ${p[300]};\n  --focus: ${p[500]};\n}\n`;
}
