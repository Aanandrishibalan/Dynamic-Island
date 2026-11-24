/* Preload for the WhatsApp Web window only.
 * WhatsApp Web raises a browser notification (sender + message text) for each new message. This wraps
 * window.Notification in the page so those notifications are also handed to the island, which shows them
 * in its own pop-up and in a Windows notification. It reads nothing else from the page.
 */
const { ipcRenderer, webFrame } = require('electron');

webFrame.executeJavaScript(`(function () {
  var Native = window.Notification; if (!Native || Native.__island) return;
  function Wrapped(title, opts) {
    try { window.postMessage({ __islandWA: 1, title: String(title), body: String((opts && opts.body) || '') }, '*'); } catch (e) {}
    // The island shows the notification itself, so the page's own pop-up is not created (avoids a duplicate).
    this.close = function () {}; this.addEventListener = function () {}; this.onclick = null;
  }
  Wrapped.prototype = Native.prototype;
  Wrapped.__island = true;
  Wrapped.requestPermission = Native.requestPermission.bind(Native);
  Object.defineProperty(Wrapped, 'permission', { get: function () { return Native.permission; } });
  Object.defineProperty(Wrapped, 'maxActions', { get: function () { return Native.maxActions; } });
  window.Notification = Wrapped;
})();`).catch(() => {});

window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source === window && d && d.__islandWA === 1) ipcRenderer.send('wa:notify', { title: String(d.title).slice(0, 120), body: String(d.body).slice(0, 300) });
});
