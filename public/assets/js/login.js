// Halaman login: tampilkan pesan galat bila server mengarahkan balik dengan ?error=1.
if (new URLSearchParams(location.search).has('error')) {
  document.getElementById('error').classList.add('show');
}

// Identitas brand client (nama dan logo) dari /brand.json; gagal = tampilan bawaan.
fetch('/brand.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((b) => {
    if (!b) return;
    if (b.name) {
      document.getElementById('brand-title').textContent = b.name;
      document.title = `Masuk - ${b.name}`;
    }
    if (b.logo) {
      const img = document.getElementById('brand-img');
      img.src = `/brand/logo?v=${Date.now()}`;
      img.classList.add('logo');
    }
  })
  .catch(() => {});
