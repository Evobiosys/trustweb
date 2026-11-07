(function () {
  var t = 'system';
  try {
    var v = localStorage.getItem('tw-theme');
    if (v === 'light' || v === 'dark') t = v;
  } catch (e) {}
  document.documentElement.dataset.theme = t;
})();
