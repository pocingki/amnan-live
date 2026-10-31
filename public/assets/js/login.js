// Halaman login: tampilkan pesan galat bila server mengarahkan balik dengan ?error=1.
if (new URLSearchParams(location.search).has('error')) {
  document.getElementById('error').classList.add('show');
}
