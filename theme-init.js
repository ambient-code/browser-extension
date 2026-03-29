// theme-init.js — Apply theme class before first paint to prevent flash.
// Must be loaded synchronously in <head> before any stylesheets take effect.
(function() {
  var theme = localStorage.getItem('acp-theme') || 'dark';
  if (theme === 'dark') document.documentElement.classList.add('dark');
})();
