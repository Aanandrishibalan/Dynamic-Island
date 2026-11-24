const { contextBridge, ipcRenderer: ipc, webUtils } = require('electron');
const on = (ch) => (cb) => ipc.on(ch, (_e, ...a) => cb(...a));
contextBridge.exposeInMainWorld('island', {
  setIgnore: (v) => ipc.send('set-ignore', v),
  wellBattery: (cur) => ipc.send('well:battery', cur), alarmSnooze: (id, min) => ipc.invoke('well:alarm-snooze', id, min), pomo: (a) => ipc.invoke('well:pomo', a), drank: () => ipc.invoke('well:drank'),
  action: (n) => ipc.send('action', n),
  chat: (m) => ipc.invoke('chat', m),
  stt: (wav) => ipc.invoke('stt', wav),
  vision: (q) => ipc.invoke('vision', q),
  getData: () => ipc.invoke('db:get'),
  locationDetect: () => ipc.invoke('location:detect'),
  setSettings: (p) => ipc.invoke('settings:set', p),
  setData: (p) => ipc.invoke('data:set', p),
  openSettings: (tab) => ipc.send('open-settings', tab),
  usage: () => ipc.invoke('usage:get'),
  weather: (f) => ipc.invoke('weather', f),
  news: (f) => ipc.invoke('news', f),
  photos: () => ipc.invoke('photos:list'),
  photoFull: (p) => ipc.invoke('photo:full', p),
  media: (a) => ipc.invoke('media', a),
  appsList: (q, force) => ipc.invoke('apps:list', q, force),
  appIcons: (ids) => ipc.invoke('apps:icons', ids),
  appLaunch: (id) => ipc.invoke('apps:launch', id),
  filesRecent: () => ipc.invoke('files:recent'),
  filesSearch: (q) => ipc.invoke('files:search', q),
  openPath: (p) => ipc.send('open-path', p),
  openUrl: (u) => ipc.send('open-url', u),
  capture: (t) => ipc.invoke('capture:add', t),
  openConv: (id) => ipc.send('open-conv', id),
  saveMedia: (kind, ext, data) => ipc.invoke('media:save', kind, ext, data),
  screenshot: (o) => ipc.invoke('capture:screen', o),
  showFile: (p) => ipc.send('file:show', p),
  vault: {
    status: () => ipc.invoke('vault:status'),
    unlock: (pass) => ipc.invoke('vault:unlock', pass),
    lock: () => ipc.invoke('vault:lock'),
    setPassphrase: (pass, oldPass) => ipc.invoke('vault:set-passphrase', pass, oldPass),
    removePassphrase: (pass) => ipc.invoke('vault:remove-passphrase', pass),
    wipe: () => ipc.invoke('vault:wipe')
  },
  onVault: (cb) => ipc.on('vault', (_e, st) => cb(st)),
  ai: {
    status: () => ipc.invoke('ai:status'),
    connect: (p, key) => ipc.invoke('ai:connect', p, key),
    disconnect: (p) => ipc.invoke('ai:disconnect', p),
    models: (p) => ipc.invoke('ai:models', p)
  },
  assist: {
    ask: (text, extra) => ipc.invoke('assist:ask', text, extra),
    act: (id) => ipc.invoke('assist:act', id),
    brief: () => ipc.invoke('assist:brief'),
    suggest: (extra) => ipc.invoke('assist:suggest', extra),
    meetingFinish: (p) => ipc.invoke('assist:meeting-finish', p),
    meetingSave: (d) => ipc.invoke('assist:meeting-save', d),
    meetingTasks: (id, idx) => ipc.invoke('assist:meeting-tasks', id, idx),
    meetingExport: (id) => ipc.invoke('assist:meeting-export', id),
    remember: (text) => ipc.invoke('assist:remember', text),
    copy: (text) => ipc.send('assist:copy', text)
  },
  tools: {
    clip: {
      list: (q, f) => ipc.invoke('clip:list', q, f), full: (id) => ipc.invoke('clip:full', id), copy: (id) => ipc.invoke('clip:copy', id), paste: (id) => ipc.invoke('clip:paste', id),
      pin: (id, on) => ipc.invoke('clip:pin', id, on), label: (id, text) => ipc.invoke('clip:label', id, text), del: (id) => ipc.invoke('clip:delete', id),
      clear: (keepSaved) => ipc.invoke('clip:clear', keepSaved), add: (text, label) => ipc.invoke('clip:add', text, label)
    },
    snip: { insert: (id) => ipc.invoke('snip:insert', id), copy: (id) => ipc.invoke('snip:copy', id) },
    expander: { status: () => ipc.invoke('expander:status') },
    win: {
      list: () => ipc.invoke('win:list'), snap: (h, zone) => ipc.invoke('win:snap', h, zone), layout: (id) => ipc.invoke('win:layout', id), focus: (h) => ipc.invoke('win:focus', h),
      save: (name) => ipc.invoke('win:save', name), apply: (id) => ipc.invoke('win:apply', id)
    },
    proc: { list: () => ipc.invoke('proc:list'), end: (ids, force) => ipc.invoke('proc:end', ids, !!force) },
    fav: { list: () => ipc.invoke('fav:list'), launch: (name) => ipc.invoke('fav:launch', name) },
    folder: { pick: () => ipc.invoke('folder:pick'), open: (id) => ipc.invoke('folder:open', id), copy: (id) => ipc.invoke('folder:copy', id) },
    rename: {
      pick: () => ipc.invoke('rename:pick'), pickFolder: () => ipc.invoke('rename:pickFolder'), plan: (files, rules) => ipc.invoke('rename:plan', files, rules),
      apply: (files, rules) => ipc.invoke('rename:apply', files, rules), undoInfo: () => ipc.invoke('rename:undoInfo'), undo: () => ipc.invoke('rename:undo'),
      dropped: (list) => Array.from(list || []).map((f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } }).filter(Boolean)   // real paths of files dropped on the page
    },
    xfer: {
      pick: () => ipc.invoke('xfer:pick'), remove: (i) => ipc.invoke('xfer:remove', i), state: () => ipc.invoke('xfer:state'), start: (o) => ipc.invoke('xfer:start', o),
      stop: () => ipc.invoke('xfer:stop'), copyLink: (i) => ipc.invoke('xfer:copyLink', i), openFolder: () => ipc.invoke('xfer:openFolder')
    },
    ocr: { snip: () => ipc.invoke('ocr:snip'), clipboard: () => ipc.invoke('ocr:clipboard'), file: () => ipc.invoke('ocr:file'), langs: () => ipc.invoke('ocr:langs') },
    qr: { make: (text) => ipc.invoke('qr:make', text), copy: (dataUrl) => ipc.invoke('qr:copy', dataUrl), save: (dataUrl) => ipc.invoke('qr:save', dataUrl) },
    fx: (force) => ipc.invoke('fx:rates', !!force)
  },
  net: {
    radios: () => ipc.invoke('net:radios'),
    radio: (kind, on) => ipc.invoke('net:radio', kind, on),
    airplane: (on) => ipc.invoke('net:airplane', on),
    online: () => ipc.invoke('net:online'),
    wifiScan: () => ipc.invoke('wifi:scan'),
    wifiConnect: (ssid, pass, auth) => ipc.invoke('wifi:connect', ssid, pass, auth),
    wifiDisconnect: () => ipc.invoke('wifi:disconnect'),
    wifiForget: (ssid) => ipc.invoke('wifi:forget', ssid),
    btList: () => ipc.invoke('bt:list')
  },
  speed: {
    live: (reset) => ipc.invoke('speed:live', !!reset),
    start: () => ipc.invoke('speed:start'),
    cancel: () => ipc.invoke('speed:cancel'),
    clear: () => ipc.invoke('speed:clear')
  },
  app: { info: () => ipc.invoke('app:info'), ack: () => ipc.invoke('app:ack') },
  mail: {
    state: () => ipc.invoke('mail:state'),
    refresh: () => ipc.invoke('mail:refresh'),
    open: (id, src) => ipc.send('mail:open', id, src),
    openSource: (src) => ipc.send('mail:open-source', src),
    setGmail: (user, pass) => ipc.invoke('mail:setGmail', user, pass),
    clearGmail: () => ipc.invoke('mail:clearGmail'),
    linkWhatsApp: () => ipc.send('mail:link-whatsapp')
  },
  sys: {
    get: () => ipc.invoke('sys:get'),
    vol: (n) => ipc.send('sys:vol', n),
    bright: (n) => ipc.send('sys:bright', n),
    apps: () => ipc.invoke('sys:apps'),
    focus: (id) => ipc.send('sys:focus', id),
    stats: () => ipc.invoke('sys:stats')
  },
  onStore: on('store'), onCollapse: on('collapse'), onToggle: on('toggle'), onOpenConv: on('open-conv'), onReminder: on('reminder'), onAlert: on('alert'), onMail: on('mail:update'), onMailNew: on('mail:new'), onGoto: on('goto'), onCapture: on('capture'), onVoice: on('voice'), onClip: on('clip'), onExpander: on('expander'), onOcr: on('ocr'), onXfer: on('xfer'), onSpeed: on('speed:progress')
});
