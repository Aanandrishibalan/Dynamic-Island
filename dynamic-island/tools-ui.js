/* Screens for the productivity tools: Clipboard, Text expander, Windows, Quick launch + folders, Rename, File transfer, Screenshot OCR,
 * Calculator + converter, QR codes. Loaded by index.html after tools.js; everything the page needs from the main page comes in through `env`.
 * Text is always inserted with textContent / escaped, never as raw HTML. */
(function (g) {
  'use strict';
  const SLIDES = [['clipboard', 'Clipboard'], ['expander', 'Text expander'], ['windows', 'Windows'], ['launch', 'Quick launch'], ['rename', 'File renamer'], ['transfer', 'File transfer'], ['ocr', 'Screenshot OCR'], ['calc', 'Calculator'], ['qr', 'QR codes'], ['taskman', 'Task manager']];

  const CSS = `
/* Bigger, easier to read controls. Every rule starts with .slide.tl so it beats the island's general .slide rules (those centred and shrank the forms). */
.slide.tl{gap:10px}
.slide.tl [hidden]{display:none!important}
.slide.tl input,.slide.tl textarea,.slide.tl select{background:var(--tile);color:var(--ink);border:0;border-radius:14px;height:42px;padding:0 14px;font:inherit;font-size:14.5px;min-width:0;user-select:text}
.slide.tl textarea{height:auto;min-height:96px;padding:11px 14px;line-height:1.4;resize:none}
.slide.tl select{padding:0 10px;font-size:14px;cursor:pointer;color-scheme:dark}
:root[data-theme=light] .slide.tl select{color-scheme:light}
.slide.tl select option{background:var(--tile2);color:var(--ink)}
.slide.tl input::placeholder,.slide.tl textarea::placeholder{color:var(--dim);opacity:1}
.slide.tl input[type=number]{padding:0 8px;text-align:center}
.slide.tl input[type=checkbox]{width:20px;height:20px;padding:0;flex:none;accent-color:var(--on);cursor:pointer}
.slide.tl input:focus-visible,.slide.tl textarea:focus-visible,.slide.tl select:focus-visible{outline:2px solid var(--on);outline-offset:1px}
.slide.tl .frm{display:flex;flex-direction:column;align-items:stretch;gap:8px;flex:none}
.slide.tl .fr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:none}
.slide.tl .fr>input,.slide.tl .fr>select{flex:1 1 120px}
.slide.tl .cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;flex:none;align-items:start}
.slide.tl .col{display:flex;flex-direction:column;gap:8px;min-width:0}
.slide.tl .col.stick{position:sticky;top:0}
.slide.tl .chk{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink);cursor:pointer;min-height:30px}
.slide.tl .chk.dim{color:var(--dim)}
.slide.tl .nbox{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--dim)}.slide.tl .nbox input{width:62px;flex:none}
.slide.tl .chips,.slide.tl .tabs{flex-wrap:wrap}
.slide.tl .chips button,.slide.tl .tabs button{height:34px;padding:0 16px;font-size:13.5px}
.slide.tl .note{color:var(--dim);font-size:13px;line-height:1.4;padding:0 4px;flex:none}.slide.tl .note.bad,.slide.tl .bad{color:#ff453a}.slide.tl .note.good,.slide.tl .good{color:var(--status)}
.slide.tl .lst{display:flex;flex-direction:column;gap:7px;min-height:0;user-select:text}
.slide.tl .lst.fill{flex:1 1 0;min-height:150px;overflow-y:auto;padding-right:2px}
.slide.tl .lst.pick{flex:none;max-height:198px;overflow-y:auto;padding-right:2px}
.slide.tl .trow{display:flex;align-items:center;gap:10px;background:var(--tile);border-radius:14px;padding:8px 12px;font-size:14px;min-height:48px;flex:none}
.slide.tl .trow .tx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text}
.slide.tl .trow .tx small{color:var(--dim);margin-left:6px}
.slide.tl .tg{flex:none;font-size:12px;background:var(--tile2);color:var(--dim);border-radius:999px;padding:3px 10px}
.slide.tl .tb,.slide.tl .trow button{background:var(--tile2);color:var(--ink);border-radius:999px;height:34px;padding:0 15px;font-size:13.5px;font-weight:500;flex:none}
.slide.tl .trow button{height:32px;padding:0 13px}
.slide.tl .trow button.on{background:var(--on);color:#fff}.slide.tl .trow button.bad:hover,.slide.tl .tb.bad:hover{background:#5a1a17;color:#ff453a}
.slide.tl .tb.go{background:var(--on);color:#fff}.slide.tl .tb[disabled]{opacity:.45;cursor:default}
.slide.tl .tb.danger{background:#ff453a;color:#fff}.slide.tl .tb.danger[disabled]{background:var(--tile2);color:var(--dim)}
.slide.tl .lay{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;flex:none}.slide.tl .lay button{background:var(--tile);color:var(--ink);border-radius:14px;height:42px;font-size:13.5px}
.slide.tl .lay button:hover,.slide.tl .tb:hover,.slide.tl .trow button:hover{background:var(--tile2)}.slide.tl .tb.go:hover{background:var(--on);filter:brightness(1.12)}.slide.tl .tb.danger:hover{background:#ff453a;filter:brightness(1.1)}
.slide.tl .drop{border:1.5px dashed var(--tile2);border-radius:14px;padding:12px;text-align:center;color:var(--dim);font-size:13.5px;flex:none;display:flex;flex-direction:column;gap:9px;align-items:center}.slide.tl .drop.over{border-color:var(--on);color:var(--ink)}
.slide.tl canvas{background:#fff;border-radius:12px;image-rendering:pixelated;align-self:center;flex:none}.slide.tl canvas.empty{background:transparent;border:1.5px dashed var(--tile2)}
/* calculator */
.slide.tl .kp{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;flex:none}
.slide.tl .kp button{background:var(--tile);color:var(--ink);border-radius:13px;height:37px;font-size:17px;font-weight:500}
.slide.tl .kp button:hover{background:var(--tile2)}.slide.tl .kp button.op{background:var(--tile2)}.slide.tl .kp button.kq{background:var(--on);color:#fff}
.slide.tl .big{font-size:30px;font-weight:600;padding:0 6px;min-height:36px;line-height:36px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text;flex:none}
.slide.tl .big.sm{font-size:24px}
/* quick launch: favourites as icon tiles */
.slide.tl .agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:9px;flex:none}
.slide.tl .atile{position:relative;display:flex;flex-direction:column;align-items:center;gap:7px;padding:14px 8px 11px;border-radius:16px;background:var(--tile);cursor:pointer;min-height:98px;text-align:center}
.slide.tl .atile:hover{background:var(--tile2)}.slide.tl .atile .nm{font-size:13px;line-height:1.25;max-width:100%;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.slide.tl .atile small{color:var(--dim);font-size:11px}
.slide.tl .atile .x{position:absolute;top:5px;right:5px;width:24px;height:24px;border-radius:50%;padding:0;background:transparent;color:var(--dim);font-size:12px;opacity:.75}.slide.tl .atile .x:hover{background:#5a1a17;color:#ff453a;opacity:1}
.slide.tl .ico{width:40px;height:40px;border-radius:10px;flex:none;object-fit:contain}
.slide.tl .ico.sm{width:30px;height:30px;border-radius:8px}
.slide.tl .ph{display:grid;place-items:center;background:var(--tile2);color:var(--dim);font-weight:700;font-size:17px}.slide.tl .ph.sm{font-size:14px}
.slide.tl .trow.pickrow{cursor:pointer}.slide.tl .trow.pickrow:hover{background:var(--tile2)}.slide.tl .trow.pickrow.have{opacity:.55;cursor:default}
/* two-line list cards (snippets, rename preview) */
.slide.tl .trow.card{flex-direction:column;align-items:stretch;gap:6px;padding:10px 12px}
.slide.tl .card .sh{display:flex;align-items:center;gap:8px;min-width:0;font-size:14.5px}.slide.tl .card .sh b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slide.tl .card .sp{color:var(--dim);font-size:13px;line-height:1.35;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:pre-wrap;word-break:break-word}
.slide.tl .card .sa{display:flex;gap:6px}.slide.tl .card .sa button{flex:1}.slide.tl .card .sa button.bad{flex:none;width:38px;padding:0}
.slide.tl .card .o{color:var(--dim);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.slide.tl .card .n{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* task manager */
.slide.tl .pmbar{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;background:var(--tile);border-radius:14px;padding:6px 12px;min-height:48px}.slide.tl .pmbar .sp{flex:1}
.slide.tl .pm{display:flex;align-items:center;gap:11px;background:var(--tile);border-radius:14px;padding:8px 12px;min-height:56px;flex:none;cursor:pointer}
.slide.tl .pm:hover{background:var(--tile2)}.slide.tl .pm.sel{background:color-mix(in srgb,var(--on) 24%,var(--tile))}.slide.tl .pm.lockd{cursor:default;opacity:.7}
.slide.tl .pm .nm{flex:1;min-width:0}.slide.tl .pm .nm b{display:block;font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slide.tl .pm .nm small{display:block;color:var(--dim);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slide.tl .pm .mem{flex:none;width:78px;text-align:right;font-size:13.5px;font-variant-numeric:tabular-nums;color:var(--dim)}
.slide.tl .pm .lk{width:20px;flex:none;text-align:center;font-size:14px;color:var(--dim)}
.slide.tl .pm button{height:32px;padding:0 14px;font-size:13px;border-radius:999px;background:var(--tile2);color:var(--ink);flex:none}.slide.tl .pm button:hover{background:#5a1a17;color:#ff453a}.slide.tl .pm button.arm{background:#ff453a;color:#fff}
`;

  g.DIToolsUI = function (env) {
    const { $, island, toast, esc, S, getDb, T } = env;
    const tools = island.tools, doc = document;
    const st = doc.createElement('style'); st.textContent = CSS; doc.head.appendChild(st);
    const el = (id) => doc.getElementById(id);
    const body = (id) => { const s = el('tl-' + id); if (s && !s.dataset.built) { s.dataset.built = '1'; s.classList.add('tl'); BUILD[id](s); } return s; };
    const say = (box, text, bad) => { box.textContent = text || ''; box.className = 'note' + (bad ? ' bad' : text ? ' good' : ''); };
    const hint = (box, text) => { box.textContent = text || ''; box.className = 'note'; };   // neutral grey: for instructions, not results
    const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (text, fn, cls) => { const b = mk('button', cls || 'tb', text); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const html = (s, h) => { s.insertAdjacentHTML('beforeend', h); return s; };
    const db = () => getDb();
    const saveData = (p) => island.setData(p);
    const size = (n) => T.fmtBytes(n);
    const tidy = (t, n) => { t = String(t); return t.length > n ? t.slice(0, n) + '…' : t; };
    const BUILD = {}, ENTER = {};

    /* ---------------- Clipboard ---------------- */
    let cbFilter = 'all', cbSeq = 0, cbArm = false;
    BUILD.clipboard = (s) => {
      html(s, `<input id="cbQ" placeholder="Search copied items (phone, invoice, address…)" aria-label="Search clipboard history">
<div class="chips" id="cbChips">${[['all', 'All'], ['saved', 'Saved'], ['phone', 'Phone'], ['address', 'Address'], ['invoice', 'Invoice'], ['url', 'Link'], ['email', 'Email'], ['text', 'Text']].map((c) => `<button data-f="${c[0]}"${c[0] === 'all' ? ' class="on"' : ''}>${c[1]}</button>`).join('')}</div>
<div class="fr"><button class="tb" id="cbPause"></button><button class="tb" id="cbAdd">＋ Save text</button><button class="tb" id="cbClear">Clear history</button></div>
<div class="frm" id="cbBox" hidden><textarea id="cbTxt" placeholder="Type or paste something to keep" maxlength="20000"></textarea><div class="fr"><input id="cbLbl" placeholder="Label (optional)" maxlength="60"><button class="tb go" id="cbSave">Save</button></div></div>
<div class="note" id="cbSub"></div><div class="lst fill" id="cbList"></div>`);
      el('cbChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; cbFilter = b.dataset.f; [...el('cbChips').children].forEach((x) => x.classList.toggle('on', x === b)); cbRender(); });
      el('cbQ').addEventListener('input', cbRender);
      el('cbPause').onclick = async () => { await island.setSettings({ clipPaused: !S().clipPaused }); cbRender(); };
      el('cbAdd').onclick = () => { el('cbBox').hidden = !el('cbBox').hidden; if (!el('cbBox').hidden) el('cbTxt').focus(); };
      el('cbSave').onclick = async () => { const r = await tools.clip.add(el('cbTxt').value, el('cbLbl').value); if (r && r.ok) { el('cbTxt').value = ''; el('cbLbl').value = ''; el('cbBox').hidden = true; cbRender(); } else toast((r && r.text) || 'Could not save'); };
      el('cbClear').onclick = async () => { if (!cbArm) { cbArm = true; el('cbClear').textContent = 'Sure? Saved items stay'; setTimeout(() => { cbArm = false; el('cbClear').textContent = 'Clear history'; }, 3000); return; } cbArm = false; el('cbClear').textContent = 'Clear history'; await tools.clip.clear(true); cbRender(); };
      el('cbList').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-a]'), row = e.target.closest('.trow'); if (!b || !row) return; const id = row.dataset.id, a = b.dataset.a;
        if (a === 'paste') { const r = await tools.clip.paste(id); if (!r || !r.ok) toast((r && r.text) || 'Could not paste'); }
        else if (a === 'copy') { await tools.clip.copy(id); toast('Copied'); }
        else if (a === 'pin') { await tools.clip.pin(id, !row.classList.contains('pinned')); cbRender(); }
        else if (a === 'del') { await tools.clip.del(id); cbRender(); }
        else if (a === 'label') { const v = prompt ? null : null; void v; }
      });
    };
    async function cbRender() {
      const my = ++cbSeq, r = await tools.clip.list(el('cbQ').value.trim(), cbFilter); if (my !== cbSeq || !r) return;
      const list = el('cbList'); list.textContent = '';
      el('cbPause').textContent = r.paused ? '▶ Resume recording' : '⏸ Pause recording';
      say(el('cbSub'), !r.enabled ? 'Clipboard history is switched off (Settings → Tools).' : r.paused ? 'Paused: nothing new is being recorded.' : r.total + ' item' + (r.total === 1 ? '' : 's') + ' · ' + r.saved + ' saved · passwords from password managers are never recorded');
      if (!r.items.length) { list.appendChild(mk('p', 'empty', r.total ? 'Nothing matches.' : 'Copy something (Ctrl+C) and it will appear here.')); return; }
      for (const c of r.items) {
        const row = mk('div', 'trow' + (c.pinned ? ' pinned' : '')); row.dataset.id = c.id;
        row.appendChild(mk('span', 'tg', c.type));
        const tx = mk('div', 'tx'); tx.title = c.text; if (c.label) tx.appendChild(mk('b', '', c.label + '  ')); tx.appendChild(doc.createTextNode(tidy(c.text.replace(/\s+/g, ' '), 90))); row.appendChild(tx);
        for (const [a, t, cls] of [['paste', 'Paste', ''], ['copy', 'Copy', ''], ['pin', c.pinned ? '★' : '☆', c.pinned ? 'on' : ''], ['del', '✕', 'bad']]) { const b = mk('button', cls, t); b.dataset.a = a; if (a === 'pin') b.title = 'Keep this item'; row.appendChild(b); }
        list.appendChild(row);
      }
    }
    ENTER.clipboard = () => { body('clipboard'); cbRender(); };
    island.onClip && island.onClip(() => { if (el('tl-clipboard') && el('tl-clipboard').dataset.built && env.cur() === 'clipboard') cbRender(); });

    /* ---------------- Text expander ---------------- */
    let spEdit = null;
    BUILD.expander = (s) => {
      html(s, `<div class="fr"><button class="tb" id="spOn"></button><span class="note" id="spSt"></span></div>
<div class="cols" style="grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)">
<div class="col"><input id="spTrig" placeholder="Trigger, for example ;sig" maxlength="20" aria-label="Trigger" autocomplete="off"><input id="spLbl" placeholder="Label (optional)" maxlength="60" aria-label="Label" autocomplete="off">
<textarea id="spTxt" style="min-height:112px" placeholder="Text to insert. You can use {date} {time} {datetime} {day} {clipboard} and {cursor}" maxlength="5000" aria-label="Text to insert"></textarea>
<div class="fr"><button class="tb go" id="spSave">Add snippet</button><button class="tb" id="spCancel" hidden>Cancel</button></div><div class="note bad" id="spErr" aria-live="polite"></div></div>
<div class="col"><div class="note">Your snippets</div><div class="lst" id="spList"></div></div></div>`);
      el('spOn').onclick = async () => { await island.setSettings({ expanderOn: !S().expanderOn }); spStatus(); };
      el('spSave').onclick = async () => {
        const trig = el('spTrig').value.trim(), text = el('spTxt').value, list = db().snippets || [];
        const bad = T.triggerProblem(trig, list, spEdit); if (bad) return say(el('spErr'), bad, true);
        if (!text.trim()) return say(el('spErr'), 'Type the text to insert.', true);
        const item = { id: spEdit || undefined, trigger: trig, text, label: el('spLbl').value };
        await saveData({ snippets: spEdit ? list.map((x) => (x.id === spEdit ? { ...x, ...item, id: spEdit } : x)) : [...list, item] });
        spReset(); spRender();
      };
      el('spCancel').onclick = () => { spReset(); };
      el('spList').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-a]'), row = e.target.closest('.trow'); if (!b || !row) return; const id = row.dataset.id, sn = (db().snippets || []).find((x) => x.id === id); if (!sn) return;
        if (b.dataset.a === 'ins') { const r = await tools.snip.insert(id); if (!r || !r.ok) toast((r && r.text) || 'Could not insert'); }
        else if (b.dataset.a === 'copy') { await tools.snip.copy(id); toast('Copied'); }
        else if (b.dataset.a === 'edit') { spEdit = id; el('spTrig').value = sn.trigger; el('spLbl').value = sn.label || ''; el('spTxt').value = sn.text; el('spSave').textContent = 'Save changes'; el('spCancel').hidden = false; el('spTrig').focus(); }
        else if (b.dataset.a === 'del') { await saveData({ snippets: (db().snippets || []).filter((x) => x.id !== id) }); if (spEdit === id) spReset(); spRender(); }
      });
    };
    function spReset() { spEdit = null; ['spTrig', 'spLbl', 'spTxt'].forEach((i) => { el(i).value = ''; }); el('spSave').textContent = 'Add snippet'; el('spCancel').hidden = true; say(el('spErr'), ''); }
    async function spStatus() {
      const r = await tools.expander.status(); if (!r) return;
      el('spOn').textContent = r.on ? 'Auto-expand: On' : 'Auto-expand: Off'; el('spOn').classList.toggle('go', r.on);
      say(el('spSt'), !r.supported ? 'Auto-expand works on Windows only. The buttons below still insert snippets.' : r.error ? r.error : r.on ? (r.running ? 'Type a trigger in any app and it is replaced.' : 'Starting…') : 'Off: nothing watches your typing. The buttons still work.', !!r.error);
      if (!r.error && !r.on) el('spSt').className = 'note';
    }
    function spRender() {
      const l = el('spList'); l.textContent = ''; const list = db().snippets || [];
      if (!list.length) l.appendChild(mk('p', 'empty', 'No snippets yet. Add one on the left.'));
      for (const sn of list) {
        const row = mk('div', 'trow card'); row.dataset.id = sn.id;
        const sh = mk('div', 'sh'); sh.appendChild(mk('span', 'tg', sn.trigger)); if (sn.label) sh.appendChild(mk('b', '', sn.label)); row.appendChild(sh);
        const sp = mk('div', 'sp', tidy(sn.text, 160)); sp.title = sn.text; row.appendChild(sp);
        const sa = mk('div', 'sa'); for (const [a, t, c] of [['ins', 'Insert', ''], ['copy', 'Copy', ''], ['edit', 'Edit', ''], ['del', '✕', 'bad']]) { const b = mk('button', c, t); b.dataset.a = a; if (a === 'del') b.title = 'Delete snippet'; sa.appendChild(b); } row.appendChild(sa);
        l.appendChild(row);
      }
    }
    ENTER.expander = () => { body('expander'); spStatus(); spRender(); };
    island.onExpander && island.onExpander(() => { if (env.cur() === 'expander') spStatus(); });

    /* ---------------- Windows ---------------- */
    BUILD.windows = (s) => {
      html(s, `<div class="note">Arrange the windows you have open.</div><div class="lay" id="wLay"></div>
<div class="fr"><input id="wName" placeholder="Name this arrangement" maxlength="40"><button class="tb go" id="wSave">Save current</button></div>
<div class="note" id="wMsg" aria-live="polite"></div><div class="note">Saved arrangements</div><div class="lst" id="wSaved" style="flex:none;max-height:90px"></div>
<div class="fr"><span class="note">Open windows</span><button class="tb" id="wRef">↻</button></div><div class="lst" id="wList"></div>`);
      const lay = el('wLay'); T.LAYOUTS.forEach((l) => lay.appendChild(btn(l.name, async () => { say(el('wMsg'), 'Arranging…'); const r = await tools.win.layout(l.id); say(el('wMsg'), r && r.text, !(r && r.ok)); wList(); })));
      el('wSave').onclick = async () => { const r = await tools.win.save(el('wName').value); say(el('wMsg'), r && r.text, !(r && r.ok)); if (r && r.ok) { el('wName').value = ''; } wSaved(); };
      el('wRef').onclick = wList;
      el('wSaved').addEventListener('click', async (e) => { const b = e.target.closest('button[data-a]'), row = e.target.closest('.trow'); if (!b || !row) return; if (b.dataset.a === 'apply') { const r = await tools.win.apply(row.dataset.id); say(el('wMsg'), r && r.text, !(r && r.ok)); } else { await saveData({ layouts: (db().layouts || []).filter((x) => x.id !== row.dataset.id) }); wSaved(); } });
      el('wList').addEventListener('click', async (e) => { const b = e.target.closest('button[data-z]'), row = e.target.closest('.trow'); if (!row) return; if (b) { const r = await tools.win.snap(row.dataset.h, b.dataset.z); if (r && !r.ok) say(el('wMsg'), r.text, true); wList(); } else await tools.win.focus(row.dataset.h); });
    };
    function wSaved() { const l = el('wSaved'); l.textContent = ''; const a = db().layouts || []; if (!a.length) l.appendChild(mk('p', 'empty', 'None yet. Arrange your windows, give it a name, press Save.')); for (const x of a) { const row = mk('div', 'trow'); row.dataset.id = x.id; row.appendChild(mk('div', 'tx', x.name + ' · ' + x.items.length + ' window' + (x.items.length > 1 ? 's' : ''))); for (const [k, t, c] of [['apply', 'Apply', ''], ['del', '✕', 'bad']]) { const b = mk('button', c, t); b.dataset.a = k; row.appendChild(b); } l.appendChild(row); } }
    async function wList() {
      const l = el('wList'), r = await tools.win.list(); l.textContent = '';
      if (!r || !r.ok) { l.appendChild(mk('p', 'empty', (r && r.text) || 'Could not list windows.')); return; }
      for (const w of r.wins) { const row = mk('div', 'trow'); row.dataset.h = w.h; row.title = 'Click the name to bring it to the front'; row.appendChild(mk('span', 'tg', w.proc)); row.appendChild(mk('div', 'tx', w.title || w.proc)); for (const [z, t] of [['left', '◧'], ['right', '◨'], ['top', '⬒'], ['bottom', '⬓'], ['max', '□']]) { const b = mk('button', '', t); b.dataset.z = z; b.title = z; row.appendChild(b); } l.appendChild(row); }
    }
    ENTER.windows = () => { body('windows'); wSaved(); wList(); };

    /* ---------------- Quick launch + folders ---------------- */
    let lnTab = 'apps', lnSeq = 0;
    const icoEl = (src, name, cls) => { if (src) { const im = doc.createElement('img'); im.className = 'ico ' + (cls || ''); im.src = src; im.alt = ''; return im; } return mk('div', 'ico ph ' + (cls || ''), (name || '?').trim().charAt(0).toUpperCase()); };
    BUILD.launch = (s) => {
      html(s, `<div class="tabs" id="lnTabs"><button data-t="apps" class="on">Favourite apps</button><button data-t="folders">Folders</button></div>
<div id="lnApps" class="frm"><div class="fr"><input id="lnQ" placeholder="Search installed apps to add" aria-label="Search installed apps" autocomplete="off"></div>
<div class="lst pick" id="lnFound" hidden></div><div class="note" id="lnHint">Click an app to open it. The ✕ removes it from this list.</div><div class="agrid" id="lnFav"></div></div>
<div id="lnFolders" class="frm" hidden><div class="fr"><button class="tb go" id="fdAdd">＋ Add folder</button><span class="note" id="fdMsg"></span></div><div class="lst" id="fdList"></div></div>`);
      el('lnTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; lnTab = b.dataset.t; [...el('lnTabs').children].forEach((x) => x.classList.toggle('on', x === b)); el('lnApps').hidden = lnTab !== 'apps'; el('lnFolders').hidden = lnTab !== 'folders'; });
      el('lnQ').addEventListener('input', lnFind);
      el('lnFound').addEventListener('click', async (e) => { const row = e.target.closest('.trow.pickrow'); if (!row || row.classList.contains('have')) return; await saveData({ favApps: [...(db().favApps || []), { name: row.dataset.name }] }); el('lnQ').value = ''; el('lnFound').hidden = true; lnFav(); });
      el('lnFav').addEventListener('click', async (e) => { const t = e.target.closest('.atile'); if (!t) return; if (e.target.closest('button[data-a="del"]')) { await saveData({ favApps: (db().favApps || []).filter((x) => x.name !== t.dataset.name) }); lnFav(); } else { const ok = await tools.fav.launch(t.dataset.name); if (!ok) toast('Could not find that app'); } });
      el('fdAdd').onclick = async () => { const f = await tools.folder.pick(); if (!f) return; const l = db().folders || []; await saveData({ folders: [...l, f] }); fdRender(); };
      el('fdList').addEventListener('click', async (e) => { const b = e.target.closest('button[data-a]'), row = e.target.closest('.trow'); if (!row) return; const id = row.dataset.id;
        if (!b || b.dataset.a === 'open') { const r = await tools.folder.open(id); if (r && r.ok === false) say(el('fdMsg'), r.text, true); else say(el('fdMsg'), ''); }
        else if (b.dataset.a === 'copy') { await tools.folder.copy(id); toast('Path copied'); } else { await saveData({ folders: (db().folders || []).filter((x) => x.id !== id) }); fdRender(); } });
    };
    /* The search list: every row shows the app's own icon (fetched in one batch), already-pinned apps are marked. */
    async function lnFind() {
      const q = el('lnQ').value.trim(), box = el('lnFound'), my = ++lnSeq;
      if (!q) { box.hidden = true; return; }
      const a = (await island.appsList(q, false)).slice(0, 30); if (my !== lnSeq) return;
      const have = new Set((db().favApps || []).map((x) => x.name.toLowerCase()));
      box.hidden = false; box.textContent = '';
      if (!a.length) { box.appendChild(mk('p', 'empty', 'No app found.')); return; }
      const icons = await island.appIcons(a.filter((x) => x.hasIcon).map((x) => x.id).slice(0, 60)); if (my !== lnSeq) return;
      for (const x of a) {
        const mine = have.has(x.name.toLowerCase()), row = mk('div', 'trow pickrow' + (mine ? ' have' : '')); row.dataset.name = x.name;
        row.appendChild(icoEl(icons[x.id], x.name, 'sm')); row.appendChild(mk('div', 'tx', x.name)); row.appendChild(mk('span', 'tg', mine ? 'Added' : '＋ Add'));
        box.appendChild(row);
      }
      box.scrollTop = 0;
    }
    async function lnFav() {
      const l = el('lnFav'), r = await tools.fav.list(); l.textContent = '';
      if (!r.length) { l.appendChild(mk('p', 'empty', 'Nothing pinned yet. Search above and click an app to pin it here.')); l.style.display = 'block'; return; }
      l.style.display = '';
      const ids = r.filter((x) => x.id && x.hasIcon).map((x) => x.id), icons = ids.length ? await island.appIcons(ids) : {};
      for (const f of r) {
        const t = mk('div', 'atile'); t.dataset.name = f.name; t.title = 'Open ' + f.name; t.setAttribute('role', 'button'); t.tabIndex = 0;
        t.appendChild(icoEl(icons[f.id], f.name)); t.appendChild(mk('div', 'nm', f.name)); if (!f.id) t.appendChild(mk('small', '', 'not installed'));
        const x = mk('button', 'x', '✕'); x.dataset.a = 'del'; x.title = 'Remove ' + f.name; x.type = 'button'; t.appendChild(x);
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === t) t.click(); });
        l.appendChild(t);
      }
    }
    function fdRender() { const l = el('fdList'); l.textContent = ''; const a = db().folders || []; if (!a.length) l.appendChild(mk('p', 'empty', 'No folders yet. Add one to open it with a single click.')); for (const f of a) { const row = mk('div', 'trow'); row.dataset.id = f.id; row.style.cursor = 'pointer'; row.appendChild(mk('span', 'ico sm ph', '📁')); const tx = mk('div', 'tx', f.name); tx.title = f.path; tx.appendChild(mk('small', '', f.path)); row.appendChild(tx); for (const [k, t, c] of [['copy', 'Copy path', ''], ['del', '✕', 'bad']]) { const b = mk('button', c, t); b.dataset.a = k; row.appendChild(b); } l.appendChild(row); } }
    ENTER.launch = () => { body('launch'); lnFav(); fdRender(); };

    /* ---------------- Batch renamer ---------------- */
    let rnFiles = [], rnSeq = 0;
    const rnRules = () => ({ base: el('rnBase').value, custom: el('rnCustom').value, find: el('rnFind').value, replace: el('rnRep').value, regex: el('rnRx').checked, spaces: el('rnSp').value, caseMode: el('rnCase').value, prefix: el('rnPre').value, suffix: el('rnSuf').value, date: el('rnDate').value, num: el('rnNum').checked, numStart: +el('rnStart').value || 1, numPad: +el('rnPad').value || 3 });
    BUILD.rename = (s) => {
      html(s, `<div class="cols" style="grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)">
<div class="col"><div class="fr"><select id="rnBase" aria-label="Base name"><option value="keep">Keep the name</option><option value="custom">New name…</option></select><input id="rnCustom" placeholder="New name" maxlength="100" aria-label="New name"></div>
<div class="fr"><input id="rnFind" placeholder="Find" aria-label="Find"><input id="rnRep" placeholder="Replace with" aria-label="Replace with"></div>
<label class="chk dim"><input type="checkbox" id="rnRx"> Find is a regular expression</label>
<div class="fr"><select id="rnSp" aria-label="Spaces"><option value="keep">Spaces: keep</option><option value="underscore">Spaces → _</option><option value="dash">Spaces → -</option><option value="remove">Remove spaces</option></select>
<select id="rnCase" aria-label="Letter case"><option value="none">Case: keep</option><option value="lower">lowercase</option><option value="upper">UPPERCASE</option><option value="title">Title Case</option><option value="sentence">Sentence case</option></select></div>
<div class="fr"><input id="rnPre" placeholder="Prefix" aria-label="Prefix"><input id="rnSuf" placeholder="Suffix" aria-label="Suffix"></div>
<div class="fr"><select id="rnDate" aria-label="Date"><option value="none">No date</option><option value="prefix">Date first</option><option value="suffix">Date last</option></select></div>
<div class="fr"><label class="chk"><input type="checkbox" id="rnNum"> Number the files</label><label class="nbox">start <input id="rnStart" type="number" value="1" min="0" title="Start at"></label><label class="nbox">digits <input id="rnPad" type="number" value="3" min="1" max="8" title="Digits"></label></div></div>
<div class="col stick"><div class="drop" id="rnDrop"><span>Drop files here, or</span><div class="fr" style="justify-content:center"><button class="tb" id="rnPick">Choose files</button><button class="tb" id="rnFolder">Choose a folder</button></div></div>
<div class="fr"><button class="tb go" id="rnGo" disabled>Rename</button><button class="tb" id="rnUndo" hidden>Undo last rename</button></div><div class="note" id="rnMsg" aria-live="polite"></div><div class="lst" id="rnList"></div></div></div>`);
      el('rnPick').onclick = async () => { rnFiles = await tools.rename.pick(); rnPlan(); };
      el('rnFolder').onclick = async () => { rnFiles = await tools.rename.pickFolder(); rnPlan(); };
      const drop = el('rnDrop'); ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
      drop.addEventListener('drop', async (e) => { e.preventDefault(); const p = tools.rename.dropped(e.dataTransfer.files); if (p.length) { rnFiles = p.map((x) => ({ path: x })); rnPlan(); } });
      s.querySelectorAll('input,select').forEach((i) => { i.addEventListener('input', rnPlan); i.addEventListener('change', rnPlan); });
      el('rnGo').onclick = async () => { const r = await tools.rename.apply(rnFiles.map((f) => f.path), rnRules()); say(el('rnMsg'), r.text, !r.ok); if (r.ok) { rnFiles = []; rnPlan(); rnUndo(); } };
      el('rnUndo').onclick = async () => { const r = await tools.rename.undo(); say(el('rnMsg'), r.text, !r.ok); rnUndo(); };
    };
    async function rnPlan() {
      const my = ++rnSeq, l = el('rnList'); if (!rnFiles.length) { l.textContent = ''; l.appendChild(mk('p', 'empty', 'Choose or drop the files to rename. A preview shows every new name before anything changes; extensions never change.')); el('rnGo').disabled = true; el('rnGo').textContent = 'Rename'; return; }
      const r = await tools.rename.plan(rnFiles.map((f) => f.path), rnRules()); if (my !== rnSeq) return;
      l.textContent = ''; el('rnGo').disabled = !r.canApply; el('rnGo').textContent = r.ok ? 'Rename ' + r.ok + ' file' + (r.ok === 1 ? '' : 's') : 'Rename';
      say(el('rnMsg'), r.canApply ? 'Check the new names, then press Rename.' : r.bad ? r.bad + ' problem' + (r.bad > 1 ? 's' : '') + ' to fix' : 'Nothing to rename yet', !r.canApply && !!r.bad);
      if (r.canApply) el('rnMsg').className = 'note';
      for (const i of r.items) { const row = mk('div', 'trow card'); row.appendChild(mk('div', 'o', i.oldName)); const nt = mk('div', 'n', '→ ' + i.newName + (i.reason ? '  — ' + i.reason : '')); if (i.status !== 'ok' && i.status !== 'same') nt.classList.add('bad'); row.appendChild(nt); l.appendChild(row); }
    }
    async function rnUndo() { const u = await tools.rename.undoInfo(); el('rnUndo').hidden = !u; }
    ENTER.rename = () => { body('rename'); rnPlan(); rnUndo(); };

    /* ---------------- File transfer ---------------- */
    BUILD.transfer = (s) => {
      html(s, `<div class="note">Send files to a phone or another PC on the same Wi-Fi, or receive from them. Off until you press Start.</div>
<div class="fr"><button class="tb" id="xfPick">＋ Choose files to share</button><label class="note"><input type="checkbox" id="xfRecv" checked> allow receiving</label><select id="xfMin"><option value="5">5 min</option><option value="10" selected>10 min</option><option value="30">30 min</option><option value="60">60 min</option></select></div>
<div class="lst" id="xfFiles" style="flex:none;max-height:80px"></div>
<div class="fr"><button class="tb go" id="xfGo">Start sharing</button><button class="tb" id="xfStop" hidden>Stop</button><span class="note" id="xfMsg" aria-live="polite"></span></div>
<div id="xfLive" class="frm" hidden><canvas id="xfQr" width="168" height="168"></canvas><div class="lst" id="xfUrls" style="flex:none"></div><div class="fr"><button class="tb" id="xfOpen">Open received folder</button></div></div>
<div class="note">Received this session</div><div class="lst" id="xfGot"></div>`);
      el('xfPick').onclick = async () => { const r = await tools.xfer.pick(); if (r) xfRender(r); };
      el('xfFiles').addEventListener('click', async (e) => { const b = e.target.closest('button[data-i]'); if (b) xfRender(await tools.xfer.remove(+b.dataset.i)); });
      el('xfGo').onclick = async () => { const r = await tools.xfer.start({ receive: el('xfRecv').checked, minutes: +el('xfMin').value }); if (!r.ok) say(el('xfMsg'), r.text, true); else xfRender(r); };
      el('xfStop').onclick = async () => xfRender(await tools.xfer.stop());
      el('xfOpen').onclick = () => tools.xfer.openFolder();
      el('xfUrls').addEventListener('click', async (e) => { const b = e.target.closest('button[data-i]'); if (b) { await tools.xfer.copyLink(+b.dataset.i); toast('Link copied'); } });
    };
    function xfRender(r) {
      if (!r) return; const l = el('xfFiles'); l.textContent = '';
      (r.picked || []).forEach((f) => { const row = mk('div', 'trow'); row.appendChild(mk('div', 'tx', f.name)); row.appendChild(mk('span', 'tg', size(f.size))); if (!r.running) { const b = mk('button', 'bad', '✕'); b.dataset.i = f.i; row.appendChild(b); } l.appendChild(row); });
      el('xfGo').hidden = !!r.running; el('xfStop').hidden = !r.running; el('xfLive').hidden = !r.running;
      say(el('xfMsg'), r.running ? (r.noNetwork ? 'No network found: only this PC can open the link.' : 'Sharing. Anyone on this network with the link can open it; stops by itself when idle.') : '');
      const u = el('xfUrls'); u.textContent = ''; (r.urls || []).forEach((url, i) => { const row = mk('div', 'trow'); row.appendChild(mk('div', 'tx', url)); const b = mk('button', '', 'Copy'); b.dataset.i = i; row.appendChild(b); u.appendChild(row); });
      if (r.running && r.urls && r.urls[0]) drawQr(el('xfQr'), r.urls[0], 168);
      const g2 = el('xfGot'); g2.textContent = ''; (r.received || []).forEach((f) => { const row = mk('div', 'trow'); row.appendChild(mk('div', 'tx', f.name)); row.appendChild(mk('span', 'tg', size(f.size))); g2.appendChild(row); });
    }
    ENTER.transfer = async () => { body('transfer'); xfRender(await tools.xfer.state()); };
    island.onXfer && island.onXfer(async () => { if (env.cur() === 'transfer') xfRender(await tools.xfer.state()); });

    /* ---------------- QR drawing (shared) ---------------- */
    async function drawQr(canvas, text, px) {
      const r = await tools.qr.make(text); if (!r || !r.ok) return r;
      const q = 3, n = r.size + q * 2, sc = Math.max(1, Math.floor(px / n)); canvas.width = canvas.height = n * sc;
      const c = canvas.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height); c.fillStyle = '#000';
      r.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '1') c.fillRect((x + q) * sc, (y + q) * sc, sc, sc); });
      canvas.style.width = canvas.style.height = canvas.width + 'px'; return r;
    }

    /* ---------------- Screenshot OCR ---------------- */
    BUILD.ocr = (s) => {
      html(s, `<div class="note">Reads text from a picture with Windows' own offline OCR. Nothing is uploaded.</div>
<div class="fr"><button class="tb go" id="ocSnip">Select area on screen</button><button class="tb" id="ocClip">From clipboard picture</button><button class="tb" id="ocFile">From file…</button></div>
<div class="note" id="ocMsg" aria-live="polite"></div><textarea id="ocOut" style="flex:1;min-height:110px" placeholder="The recognised text appears here" aria-label="Recognised text"></textarea>
<div class="fr"><button class="tb" id="ocCopy">Copy text</button><span class="note">Shortcut: Ctrl+Alt+O (change in Settings)</span></div>`);
      const show = (r) => { if (!r) return; if (r.cancelled) return say(el('ocMsg'), ''); if (r.ok) { el('ocOut').value = r.text; say(el('ocMsg'), 'Done' + (r.copied ? ' · copied to the clipboard' : '') + (r.note ? ' · ' + r.note : '')); } else say(el('ocMsg'), r.text, true); };
      el('ocSnip').onclick = async () => { say(el('ocMsg'), 'Select the area…'); show(await tools.ocr.snip()); };
      el('ocClip').onclick = async () => { say(el('ocMsg'), 'Reading…'); show(await tools.ocr.clipboard()); };
      el('ocFile').onclick = async () => { say(el('ocMsg'), 'Reading…'); show(await tools.ocr.file()); };
      el('ocCopy').onclick = async () => { const t = el('ocOut').value; if (t) { island.assist.copy(t); toast('Copied'); } };
      s._show = show;
    };
    ENTER.ocr = () => { body('ocr'); };
    island.onOcr && island.onOcr((r) => { const s = body('ocr'); s._show && s._show(r); });

    /* ---------------- Calculator + converter ---------------- */
    let cAng = 'deg', cAns = null, cvRates = null, cvCat = 'length';
    BUILD.calc = (s) => {
      html(s, `<div class="tabs" id="cTabs"><button data-t="calc" class="on">Calculator</button><button data-t="conv">Converter</button></div>
<div id="cPane" class="cols" style="grid-template-columns:minmax(0,1.5fr) minmax(0,.9fr)">
<div class="col"><input id="cIn" placeholder="Type, for example 20% of 150 or sqrt(144)" autocomplete="off" aria-label="Expression"><div class="big" id="cOut" aria-live="polite"></div><div class="kp" id="cKeys"></div></div>
<div class="col"><div class="fr"><button class="tb" id="cAng"></button><button class="tb" id="cHist">Clear history</button></div><div class="note">History: click one to reuse it</div><div class="lst" id="cHl"></div></div></div>
<div id="vPane" class="frm" hidden><input id="vIn" placeholder="Type, for example 5 km to mi, 72 f to c, 100 usd to inr" autocomplete="off" aria-label="Conversion"><div class="big sm" id="vOut" aria-live="polite"></div>
<div class="fr"><select id="vCat" aria-label="Category"></select><input id="vVal" type="number" value="1" step="any" aria-label="Amount"></div><div class="fr"><select id="vFrom" aria-label="From"></select><span class="note">→</span><select id="vTo" aria-label="To"></select></div><div class="big" id="vRes"></div><div class="note" id="vNote"></div></div>`);
      el('cTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; [...el('cTabs').children].forEach((x) => x.classList.toggle('on', x === b)); el('cPane').hidden = b.dataset.t !== 'calc'; el('vPane').hidden = b.dataset.t !== 'conv'; if (b.dataset.t === 'conv') cvInit(); else el('cIn').focus(); });
      const keys = ['7', '8', '9', '÷', 'C', '4', '5', '6', '×', '⌫', '1', '2', '3', '−', '(', '0', '.', '%', '+', ')', 'ans', '^', '√', 'π', '='];
      const map = { '÷': '/', '×': '*', '−': '-', '√': 'sqrt(', 'π': 'pi', 'ans': 'ans' };
      // the = key is class 'kq', not 'eq': the island's music equalizer uses .eq{display:none}, which used to hide it
      keys.forEach((k) => { const b = mk('button', /[÷×−+^%]/.test(k) ? 'op' : k === '=' ? 'kq' : '', k); b.onclick = () => { const i = el('cIn'); if (k === 'C') i.value = ''; else if (k === '⌫') i.value = i.value.slice(0, -1); else if (k === '=') return cEval(true); else i.value += map[k] || k; cEval(false); i.focus(); }; el('cKeys').appendChild(b); });
      el('cIn').addEventListener('input', () => cEval(false)); el('cIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') cEval(true); });
      el('cAng').onclick = () => { cAng = cAng === 'deg' ? 'rad' : 'deg'; cAngLbl(); cEval(false); };
      el('cHist').onclick = async () => { await saveData({ calcHistory: [] }); cHist(); };
      el('cHl').addEventListener('click', (e) => { const row = e.target.closest('.trow'); if (row) { el('cIn').value = row.dataset.e; cEval(false); } });
      cAngLbl();
      el('vIn').addEventListener('input', vText);
      ['vCat', 'vVal', 'vFrom', 'vTo'].forEach((i) => el(i).addEventListener(i === 'vCat' ? 'change' : 'input', i === 'vCat' ? () => { cvCat = el('vCat').value; vFill(); vCalc(); } : vCalc));
    };
    const cAngLbl = () => { el('cAng').textContent = 'Angles: ' + (cAng === 'deg' ? 'degrees' : 'radians'); };
    function cEval(commit) {
      const src = el('cIn').value, r = T.calc(src, { angle: cAng, ans: cAns }); const o = el('cOut');
      if (!src.trim()) { o.textContent = ''; return; }
      if (r.ok) { o.textContent = '= ' + r.text; o.classList.remove('bad'); if (commit) { cAns = r.value; const h = [{ e: src, r: r.text }, ...(db().calcHistory || []).filter((x) => x.e !== src)].slice(0, 30); saveData({ calcHistory: h }).then(cHist); } }
      else { o.textContent = commit ? r.error : ''; o.classList.toggle('bad', !!commit); }
    }
    function cHist() { const l = el('cHl'); l.textContent = ''; for (const h of db().calcHistory || []) { const row = mk('div', 'trow'); row.dataset.e = h.e; row.style.cursor = 'pointer'; row.appendChild(mk('div', 'tx', h.e)); row.appendChild(mk('span', 'tg', '= ' + h.r)); l.appendChild(row); } }
    async function cvInit() {
      if (!el('vCat').options.length) { for (const k of Object.keys(T.UNITS)) el('vCat').add(new Option(T.UNITS[k].name, k)); el('vCat').add(new Option('Currency', 'currency')); vFill(); }
      if (!cvRates) { const r = await tools.fx(false); if (r && r.ok) cvRates = r; el('vNote').textContent = r && r.ok ? 'Exchange rates from open.er-api.com · ' + new Date(r.t).toLocaleDateString() + (r.stale ? ' (offline copy)' : '') : (r && r.text) || ''; }
      vFill(); vCalc();
    }
    function vFill() {
      const f = el('vFrom'), t = el('vTo'), pf = f.value, pt = t.value; f.textContent = ''; t.textContent = '';
      let ids;
      if (cvCat === 'currency') ids = (T.CURRENCY_COMMON.concat(cvRates ? Object.keys(cvRates.rates).filter((c) => !T.CURRENCY_COMMON.includes(c)).sort() : [])).map((c) => [c, c]);
      else ids = Object.keys(T.UNITS[cvCat].units).map((k) => [k, T.UNITS[cvCat].units[k][0] + ' (' + k + ')']);
      ids.forEach(([v, n]) => { f.add(new Option(n, v)); t.add(new Option(n, v)); });
      if (ids.some((x) => x[0] === pf)) f.value = pf; if (ids.some((x) => x[0] === pt)) t.value = pt; else if (ids.length > 1) t.selectedIndex = 1;
    }
    function vCalc() { const v = parseFloat(el('vVal').value), r = T.convert(cvCat, el('vFrom').value, el('vTo').value, v, cvRates); el('vRes').textContent = Number.isFinite(r) ? T.formatConv(r) + ' ' + el('vTo').value : (cvCat === 'currency' && !cvRates ? 'Rates not loaded' : '—'); }
    function vText() { const t = el('vIn').value, r = T.parseConversion(t, cvRates); el('vOut').textContent = r.ok ? '= ' + T.formatConv(r.result) + ' ' + r.to : ''; if (r.ok) { cvCat = r.cat; el('vCat').value = r.cat; vFill(); el('vFrom').value = r.from; el('vTo').value = r.to; el('vVal').value = r.value; vCalc(); } }
    ENTER.calc = () => { body('calc'); cHist(); setTimeout(() => { if (!el('cPane').hidden) el('cIn').focus(); }, 50); };

    /* ---------------- QR generator ---------------- */
    let qrMode = 'text', qrSeq = 0;
    const QF = { text: [['text', 'Text or link', 'ta']], wifi: [['ssid', 'Network name'], ['pass', 'Password'], ['auth', '', 'auth']], contact: [['name', 'Name'], ['phone', 'Phone'], ['email', 'Email'], ['org', 'Company']], phone: [['text', 'Phone number']], email: [['text', 'Email address']] };
    BUILD.qr = (s) => {
      html(s, `<div class="chips" id="qrTabs">${[['text', 'Text / link'], ['wifi', 'Wi-Fi'], ['contact', 'Contact'], ['phone', 'Phone'], ['email', 'Email']].map((c) => `<button data-m="${c[0]}"${c[0] === 'text' ? ' class="on"' : ''}>${c[1]}</button>`).join('')}</div>
<div class="cols" style="grid-template-columns:minmax(0,1fr) 224px"><div class="col"><div class="frm" id="qrForm"></div><div class="note" id="qrMsg" aria-live="polite"></div></div>
<div class="col"><canvas id="qrCv" class="empty" width="200" height="200" aria-label="QR code"></canvas><div class="fr" style="justify-content:center"><button class="tb" id="qrCopy">Copy image</button><button class="tb" id="qrSave">Save PNG</button></div></div></div>`);
      el('qrTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; qrMode = b.dataset.m; [...el('qrTabs').children].forEach((x) => x.classList.toggle('on', x === b)); qrForm(); });
      el('qrCopy').onclick = async () => { const ok = await tools.qr.copy(el('qrCv').toDataURL('image/png')); toast(ok ? 'QR image copied' : 'Nothing to copy'); };
      el('qrSave').onclick = async () => { const r = await tools.qr.save(el('qrCv').toDataURL('image/png')); if (r.ok) toast('Saved', r.path); else toast(r.text || 'Could not save'); };
      qrForm();
    };
    function qrForm() {
      const f = el('qrForm'); f.textContent = '';
      for (const [k, ph, kind] of QF[qrMode]) {
        let i; if (kind === 'ta') { i = doc.createElement('textarea'); i.maxLength = 600; i.style.minHeight = '150px'; } else if (kind === 'auth') { i = doc.createElement('select'); [['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'Open (no password)']].forEach(([v, n]) => i.add(new Option(n, v))); } else { i = doc.createElement('input'); i.maxLength = 100; if (k === 'pass') i.type = 'text'; }
        i.dataset.k = k; if (ph) i.placeholder = ph; i.addEventListener('input', qrMake); i.addEventListener('change', qrMake); f.appendChild(i);
      }
      qrMake();
    }
    async function qrMake() {
      const o = {}; el('qrForm').querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = i.value; });
      const text = T.qrPayload(qrMode, o), my = ++qrSeq, cv = el('qrCv');
      if (!text) { cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); cv.classList.add('empty'); cv.style.width = cv.style.height = '200px'; hint(el('qrMsg'), 'Fill in the fields and the code appears on the right.'); return; }
      const r = await drawQr(cv, text, 200); if (my !== qrSeq) return; cv.classList.toggle('empty', !(r && r.ok)); if (r && r.ok) hint(el('qrMsg'), ''); else say(el('qrMsg'), (r && r.text) || 'Could not make a code', true);
    }
    ENTER.qr = () => { body('qr'); };

    /* ---------------- Task manager ---------------- */
    let pmTab = 'apps', pmData = null, pmSel = new Set(), pmArm = null, pmArmT = 0, pmConfirm = false, pmBusy = false, pmTimer = 0, pmForce = [];
    BUILD.taskman = (s) => {
      html(s, `<div class="fr" style="justify-content:space-between;flex-wrap:nowrap"><div class="tabs" id="pmTabs"><button data-t="apps" class="on">Apps <span id="pmNa"></span></button><button data-t="bg">Background <span id="pmNb"></span></button></div>
<div class="fr" style="flex-wrap:nowrap"><input id="pmQ" placeholder="Filter by name" aria-label="Filter running programs" style="width:170px;flex:none" autocomplete="off"><button class="tb" id="pmRef" title="Refresh now" aria-label="Refresh">↻</button></div></div>
<div class="pmbar" id="pmBar"><label class="chk"><input type="checkbox" id="pmAll"> Select all</label><span class="note" id="pmCount"></span><span class="sp"></span><button class="tb" id="pmNo" hidden>Cancel</button><button class="tb danger" id="pmEnd" disabled>End selected</button></div>
<div class="fr" style="flex-wrap:nowrap"><span class="note" id="pmMsg" aria-live="polite" style="flex:1"></span><button class="tb danger" id="pmForce" hidden>Force end</button></div>
<div class="lst fill" id="pmList"></div>`);
      el('pmTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; pmTab = b.dataset.t; pmSel.clear(); pmDisarm(); [...el('pmTabs').children].forEach((x) => x.classList.toggle('on', x === b)); say(el('pmMsg'), ''); el('pmForce').hidden = true; pmPaint(); });
      el('pmQ').addEventListener('input', pmPaint);
      el('pmRef').onclick = () => pmLoad(true);
      el('pmAll').onchange = () => { const rows = pmRows().filter((x) => !x.protected); if (el('pmAll').checked) rows.forEach((x) => pmSel.add(x.id)); else rows.forEach((x) => pmSel.delete(x.id)); pmDisarm(); pmPaint(); };
      el('pmEnd').onclick = () => { if (!pmSel.size) return; if (!pmConfirm) { pmConfirm = true; clearTimeout(pmArmT); pmArmT = setTimeout(pmDisarm, 6000); pmBar(); } else pmEndIds([...pmSel], pmTab === 'bg'); };
      el('pmNo').onclick = () => { pmDisarm(); };
      el('pmForce').onclick = () => { const ids = pmForce.slice(); el('pmForce').hidden = true; if (ids.length) pmEndIds(ids, true); };
      el('pmList').addEventListener('click', (e) => {
        const row = e.target.closest('.pm'); if (!row) return; const id = row.dataset.id, g = pmFind(id); if (!g || g.protected) return;
        const b = e.target.closest('button[data-a="end"]');
        if (b) { if (pmArm !== id) { clearTimeout(pmArmT); pmConfirm = false; pmArm = id; pmPaint(); pmArmT = setTimeout(pmDisarm, 3500); } else { pmDisarm(); pmEndIds([id], pmTab === 'bg'); } return; }   // first click: the row's button turns into "Sure?"; second click ends
        pmDisarm(); if (pmSel.has(id)) pmSel.delete(id); else pmSel.add(id); pmPaint();
      });
    };
    const pmFind = (id) => pmData && [...pmData.apps, ...pmData.bg].find((x) => x.id === id);
    const pmRows = () => { if (!pmData) return []; const q = (el('pmQ').value || '').trim().toLowerCase(); return (pmTab === 'bg' ? pmData.bg : pmData.apps).filter((x) => !q || (x.name + ' ' + x.title).toLowerCase().includes(q)); };
    function pmDisarm() { clearTimeout(pmArmT); pmArm = null; pmConfirm = false; if (el('tl-taskman') && el('tl-taskman').dataset.built) pmPaint(); }
    function pmBar() {
      const n = pmSel.size, rows = pmRows().filter((x) => !x.protected), allOn = rows.length > 0 && rows.every((x) => pmSel.has(x.id));
      el('pmAll').checked = allOn; el('pmAll').disabled = !rows.length;
      const what = pmTab === 'bg' ? 'process' : 'app';
      const mem = [...pmSel].reduce((t, id) => t + ((pmFind(id) || {}).mem || 0), 0);
      el('pmCount').textContent = n ? n + ' selected · frees about ' + T.fmtMem(mem) : pmData ? rows.length + ' ' + what + (rows.length === 1 ? '' : 's') + ' · ' + T.fmtMem(rows.reduce((t, x) => t + x.mem, 0)) + ' in use' : '';
      el('pmEnd').disabled = !n; el('pmEnd').textContent = pmConfirm ? 'Yes, end ' + n + ' ' + what + (n === 1 ? '' : 's') : 'End selected';
      el('pmNo').hidden = !pmConfirm;
    }
    function pmPaint() {
      if (!el('pmList')) return;
      const list = el('pmList'), st = list.scrollTop, rows = pmRows(), frag = doc.createDocumentFragment();
      el('pmNa').textContent = pmData ? '(' + pmData.apps.length + ')' : ''; el('pmNb').textContent = pmData ? '(' + pmData.bg.length + ')' : '';
      for (const g of rows) {
        const row = mk('div', 'pm' + (pmSel.has(g.id) ? ' sel' : '') + (g.protected ? ' lockd' : '')); row.dataset.id = g.id;
        if (g.protected) { const k = mk('span', 'lk', '🔒'); k.title = 'Part of Windows: cannot be ended here'; row.appendChild(k); }
        else { const c = doc.createElement('input'); c.type = 'checkbox'; c.checked = pmSel.has(g.id); c.tabIndex = -1; c.setAttribute('aria-label', 'Select ' + g.name); c.addEventListener('click', (e) => e.preventDefault()); row.appendChild(c); }
        row.appendChild(icoEl(g.icon, g.name, 'sm'));
        const nm = mk('div', 'nm'); nm.appendChild(mk('b', '', g.name)); nm.appendChild(mk('small', '', g.protected ? 'Part of Windows' : (g.title || (g.n > 1 ? g.n + ' processes' : 'No window')) + (g.title && g.n > 1 ? ' · ' + g.n + ' processes' : ''))); row.appendChild(nm);
        row.appendChild(mk('span', 'mem', T.fmtMem(g.mem)));
        if (!g.protected) { const b = mk('button', pmArm === g.id ? 'arm' : '', pmArm === g.id ? 'Sure?' : 'End'); b.dataset.a = 'end'; b.type = 'button'; b.title = 'End ' + g.name; row.appendChild(b); }
        frag.appendChild(row);
      }
      list.replaceChildren(frag);
      if (!rows.length) list.appendChild(mk('p', 'empty', !pmData ? 'Loading…' : (el('pmQ').value ? 'Nothing matches.' : pmTab === 'bg' ? 'No background processes found.' : 'No apps with a window are open.')));
      list.scrollTop = st; pmBar();
    }
    async function pmLoad(manual) {
      if (pmBusy) return; pmBusy = true;
      try {
        const r = await tools.proc.list();
        if (!r || !r.ok) { pmData = null; say(el('pmMsg'), (r && r.text) || 'Could not read the running programs.', true); pmPaint(); return; }
        pmData = r; const ids = new Set([...r.apps, ...r.bg].map((x) => x.id)); [...pmSel].forEach((id) => { if (!ids.has(id)) pmSel.delete(id); });
        if (manual) say(el('pmMsg'), ''); pmPaint();
      } finally { pmBusy = false; }
    }
    async function pmEndIds(ids, force) {
      pmDisarm(); pmBusy = true; el('pmEnd').disabled = true; hint(el('pmMsg'), 'Ending…'); el('pmForce').hidden = true;
      let r; try { r = await tools.proc.end(ids, force); } finally { pmBusy = false; }
      if (!r || !r.ok) { say(el('pmMsg'), (r && r.text) || 'Could not end the selection.', true); await pmLoad(); return; }
      (r.closed || []).forEach((id) => pmSel.delete(id));
      const waiting = (r.still || []).filter((id) => !(r.noAccess || []).includes(id));
      say(el('pmMsg'), r.text, !!(r.still && r.still.length)); if (!(r.still && r.still.length)) el('pmMsg').className = 'note good';
      pmForce = waiting; el('pmForce').hidden = !(waiting.length && !force);
      await pmLoad();
    }
    ENTER.taskman = () => {
      body('taskman'); pmDisarm(); pmData = null; pmPaint(); pmLoad();
      clearInterval(pmTimer);
      pmTimer = setInterval(() => {   // refresh every few seconds, only while this slide is open on screen and nothing is waiting for a yes
        if (env.cur() !== 'taskman' || !doc.querySelector('.island.open')) { if (env.cur() !== 'taskman') clearInterval(pmTimer); return; }
        if (!pmBusy && !pmConfirm && pmArm === null) pmLoad();
      }, 4000);
    };

    return { SLIDES, ENTER };
  };
})(typeof window !== 'undefined' ? window : globalThis);
