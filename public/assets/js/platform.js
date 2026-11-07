// Deteksi OS untuk tampilan. Bukan React Native: ini browser.
// iOS memakai font sistem (SF Pro lewat -apple-system). Android memakai Roboto yang sudah terpasang di perangkat.
// Desktop (bukan iPhone/iPad/Android) tetap "other" supaya layout desktop tidak berubah.

export function detectOs(ua = '', platform = '', touchPoints = 0) {
  const text = String(ua);
  const iPadOs = platform === 'MacIntel' && Number(touchPoints) > 1;
  if (/iPad|iPhone|iPod/.test(text) || iPadOs) return 'ios';
  if (/Android/i.test(text)) return 'android';
  return 'other';
}

export function applyOs(root = typeof document !== 'undefined' ? document.documentElement : null) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const os = detectOs(nav.userAgent, nav.platform, nav.maxTouchPoints);
  if (root?.dataset) root.dataset.os = os;
  return os;
}

applyOs();
