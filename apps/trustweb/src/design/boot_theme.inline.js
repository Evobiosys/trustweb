(function () {
  var t = 'system';
  try {
    var v = localStorage.getItem('tw-theme');
    if (v === 'light' || v === 'dark') t = v;
  } catch (e) {}
  document.documentElement.dataset.theme = t;
  try {
    var l = localStorage.getItem('tw-look');
    if (l === 'sleek' || l === 'dex') document.documentElement.dataset.look = l;
  } catch (e) {}
  var m = 'on';
  try {
    var c = navigator.connection;
    var slow = c && (c.saveData || c.effectiveType === 'slow-2g' || c.effectiveType === '2g' || c.effectiveType === '3g');
    if (slow || matchMedia('(prefers-reduced-motion: reduce)').matches) m = 'off';
  } catch (e) {}
  document.documentElement.dataset.motion = m;
})();
