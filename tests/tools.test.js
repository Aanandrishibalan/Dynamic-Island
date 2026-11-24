const T = require('../dynamic-island/tools.js');
let f = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f++; };
const eq = (a, b, m) => { const s = JSON.stringify(a) === JSON.stringify(b); ok(s, m + (s ? '' : '  got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b))); };
const near = (a, b, m, e = 1e-9) => ok(Math.abs(a - b) <= e * Math.max(1, Math.abs(b)), m + (Math.abs(a - b) <= e * Math.max(1, Math.abs(b)) ? '' : '  got ' + a + ' want ' + b));

/* ---------- clipboard: classification (the examples from the brief) ---------- */
const cls = (t) => T.classifyClip(t);
eq(cls('+91 98765 43210'), 'phone', 'phone number with country code');
eq(cls('(044) 2345-6789'), 'phone', 'phone number with brackets');
eq(cls('9876543210'), 'phone', '10 digits = phone');
eq(cls('INV-2026-0042'), 'invoice', 'invoice number INV-2026-0042');
eq(cls('Invoice #10234'), 'invoice', 'Invoice #10234');
eq(cls('#10234'), 'invoice', '#10234');
eq(cls('PO/2026/118'), 'invoice', 'PO/2026/118');
eq(cls('No. 12, Gandhi Road, Anna Nagar, Chennai 600040'), 'address', 'Indian address with PIN');
eq(cls('221B Baker Street\nLondon NW1 6XE'), 'address', 'multi-line street address');
eq(cls('https://example.com/a?b=1'), 'url', 'url'); eq(cls('www.example.com'), 'url', 'www url');
eq(cls('me@example.com'), 'email', 'email');
eq(cls('2026-11-21'), 'text', 'ISO date is not a phone number'); eq(cls('21/11/2026'), 'text', 'dd/mm/yyyy is not a phone number');
eq(cls('1,234.50'), 'number', 'amount'); eq(cls('₹1,50,000'), 'number', 'rupee amount');
eq(cls('hello'), 'text', 'short text');
eq(cls('Lorem ipsum dolor sit amet, '.repeat(10)), 'paragraph', 'long text = paragraph'); eq(cls('line one\nline two'), 'paragraph', 'multi-line text = paragraph');
eq(cls('   '), 'text', 'blank');

/* ---------- clipboard: history behaviour ---------- */
let list = [], now = 1000000;
for (let i = 0; i < 12; i++) list = T.addClip(list, 'item ' + i, now + i, { max: 10 }).list;
eq(list.length, 10, 'history is capped at max (10)'); eq(list[0].text, 'item 11', 'newest first');
let r = T.addClip(list, 'item 5', now + 100, { max: 10 }); eq(r.list[0].text, 'item 5', 'copying the same text again moves it to the top'); eq(r.list.length, 10, '... without duplicating it');
let pinned = r.list.map((c) => (c.text === 'item 3' ? { ...c, pinned: true, label: 'my phone' } : c));
for (let i = 20; i < 60; i++) pinned = T.addClip(pinned, 'later ' + i, now + 200 + i, { max: 10 }).list;
ok(pinned.some((c) => c.text === 'item 3' && c.pinned && c.label === 'my phone'), 'a saved (pinned) item survives the size limit with its label');
eq(pinned.filter((c) => !c.pinned).length, 10, 'only unpinned items are trimmed');
const again = T.addClip(pinned, 'item 3', now + 999, { max: 10 }).list.find((c) => c.text === 'item 3'); ok(again.pinned && again.label === 'my phone', 're-copying a saved item keeps pin + label');
eq(T.addClip([], '   ', 1).added, null, 'whitespace is not saved'); eq(T.addClip([], 'x'.repeat(T.CLIP_MAX_LEN + 1), 1).added, null, 'oversized text is not saved');
const old = [{ id: 'a', t: 0, text: 'old', type: 'text', pinned: false }, { id: 'b', t: 0, text: 'old pinned', type: 'text', pinned: true }, { id: 'c', t: 86400000 * 9, text: 'new', type: 'text', pinned: false }];
eq(T.purgeClips(old, 7, 86400000 * 10).map((c) => c.id), ['b', 'c'], 'retention drops old unpinned, keeps pinned'); eq(T.purgeClips(old, 0, 86400000 * 99).length, 3, 'retention 0 = keep forever');
const sl = [{ id: '1', text: 'Call Ravi on +91 98765 43210', type: 'text', label: '', pinned: true, t: 1 }, { id: '2', text: 'INV-2026-0042', type: 'invoice', label: 'Acme bill', pinned: false, t: 2 }, { id: '3', text: 'ravi@x.com', type: 'email', label: '', pinned: false, t: 3 }];
eq(T.searchClips(sl, 'ravi', 'all').map((c) => c.id), ['1', '3'], 'search finds text'); eq(T.searchClips(sl, 'acme', 'all').map((c) => c.id), ['2'], 'search finds labels');
eq(T.searchClips(sl, 'ravi', 'email').map((c) => c.id), ['3'], 'type filter + search'); eq(T.searchClips(sl, '', 'saved').map((c) => c.id), ['1'], 'saved filter'); eq(T.searchClips(sl, 'call 98765', 'all').length, 1, 'all words must match');
ok(T.clipPreview({ id: 'x', t: 1, text: 'a'.repeat(1000), type: 'text' }, 100).text.length === 101, 'preview is truncated');
ok(T.sanitizeClip({ text: '  ' }) === null && T.sanitizeClip({ text: 'hi', type: 'bogus' }).type === 'text', 'sanitizeClip validates');

/* ---------- text expander ---------- */
ok(T.sanitizeSnippet({ trigger: ';sig', text: 'Regards' }) && !T.sanitizeSnippet({ trigger: 'sig', text: 'x' }) && !T.sanitizeSnippet({ trigger: ';', text: 'x' }) && !T.sanitizeSnippet({ trigger: ';a b', text: 'x' }) && !T.sanitizeSnippet({ trigger: ';sig', text: '' }), 'triggers must start with a symbol, no spaces; text required');
eq(T.sanitizeSnippets([{ trigger: ';a1', text: 'x' }, { trigger: ';A1', text: 'y' }, { trigger: 'bad', text: 'z' }]).length, 1, 'duplicate triggers (any case) and bad ones are dropped');
ok(T.triggerProblem(';ty', [{ id: '1', trigger: ';ty' }]) === 'That trigger is already used' && T.triggerProblem(';ty', [{ id: '1', trigger: ';ty' }], '1') === '', 'duplicate trigger reported, but editing itself is fine');
ok(/Clashes with ;ty/.test(T.triggerProblem(';tyx', [{ id: '1', trigger: ';ty' }])) && /Clashes with ;tyx/.test(T.triggerProblem(';ty', [{ id: '1', trigger: ';tyx' }])) && T.triggerProblem(';ty', [{ id: '1', trigger: ';sig' }]) === '', 'a trigger that starts another could never be completed (instant expansion): refused');
const NOW = new Date(2026, 10, 21, 9, 5);
eq(T.expandTemplate('Date: {date}', NOW, { dateFormat: 'dmy' }).text, 'Date: 21/11/2026', '{date} dmy'); eq(T.expandTemplate('{date}', NOW, { dateFormat: 'ymd' }).text, '2026-11-21', '{date} ymd');
eq(T.expandTemplate('{time}', NOW).text, '09:05', '{time} 24h'); eq(T.expandTemplate('{datetime}', NOW, { dateFormat: 'ymd' }).text, '2026-11-21 09:05', '{datetime}');
eq(T.expandTemplate('{day}', NOW).text, 'Saturday', '{day}'); eq(T.expandTemplate('Pasted: {clipboard}', NOW, { clipboard: 'abc' }).text, 'Pasted: abc', '{clipboard}');
eq(T.expandTemplate('Hi {cursor},\nBye', NOW), { text: 'Hi ,\nBye', back: 5 }, '{cursor} -> caret position counted from the end'); eq(T.expandTemplate('a{cursor}b{cursor}c', NOW), { text: 'abc', back: 2 }, 'only the first {cursor} counts');
eq(T.expandTemplate('{unknown} stays', NOW).text, '{unknown} stays', 'unknown placeholders are left alone');
ok(T.typeable('short line') && !T.typeable('two\nlines') && !T.typeable('x'.repeat(301)), 'short single lines are typed, long / multi-line pasted');

/* ---------- calculator ---------- */
const C = (e, o) => T.calc(e, o);
const val = (e, o) => { const r = C(e, o); return r.ok ? r.value : 'ERR:' + r.error; };
near(val('2+3*4'), 14, 'precedence'); near(val('(2+3)*4'), 20, 'brackets'); near(val('2^3^2'), 512, '^ is right-associative'); near(val('-2^2'), -4, '-2^2 = -4'); near(val('2*-3'), -6, 'unary minus after operator');
near(val('10/4'), 2.5, 'division'); eq(val('1/0'), 'ERR:Cannot divide by zero', 'divide by zero'); eq(val('5 mod 0'), 'ERR:Cannot divide by zero', 'mod by zero'); near(val('10 mod 3'), 1, 'mod');
eq(C('0.1+0.2').text, '0.3', '0.1+0.2 shows 0.3'); eq(C('1/3').text, '0.333333333333', '12 significant digits');
near(val('50%'), 0.5, '50% = 0.5'); near(val('200+10%'), 220, '200 + 10% = 220'); near(val('200-10%'), 180, '200 - 10% = 180'); near(val('20% of 150'), 30, '20% of 150'); near(val('150*20%'), 30, '150 * 20%'); near(val('200+10%+10%'), 242, 'chained percents');
near(val('sqrt(16)+abs(-3)'), 7, 'functions'); near(val('max(1,5,3)'), 5, 'max'); near(val('min(4,2)'), 2, 'min'); near(val('pow(2,10)'), 1024, 'pow'); near(val('round(2.6)'), 3, 'round');
near(val('sin(90)'), 1, 'sin in degrees (default)'); near(val('sin(pi/2)', { angle: 'rad' }), 1, 'sin in radians'); near(val('asin(1)'), 90, 'asin in degrees'); near(val('cos(60)'), 0.5, 'cos 60 deg', 1e-12);
near(val('5!'), 120, 'factorial'); eq(val('171!'), 'ERR:Result too large', 'factorial limit'); eq(val('(-1)!'), 'ERR:Factorial needs a whole number ≥ 0', 'negative factorial');
near(val('2pi'), 2 * Math.PI, 'implicit multiplication 2pi'); near(val('2(3+4)'), 14, '2(3+4)'); near(val('(1+1)(2+2)'), 8, '(1+1)(2+2)');
near(val('ans*2', { ans: 21 }), 42, 'ans'); eq(val('ans+1'), 'ERR:No previous answer', 'ans without history');
near(val('1,234 + 1'), 1235, 'thousands separators'); near(val('1,00,000 / 2'), 50000, 'Indian digit grouping'); near(val('max(1,234)'), 234, 'comma in a function call is an argument separator, not a thousands mark');
near(val('12 × 3 ÷ 4'), 9, '× and ÷'); near(val('2 ** 3'), 8, '** is power'); near(val('√9'), 3, '√'); near(val('.5+.5'), 1, 'leading-dot numbers'); near(val('1e3+1'), 1001, 'scientific notation'); near(val('3 x 4'), 12, '"x" as times');
eq(val('2+'), 'ERR:Incomplete expression', 'incomplete'); eq(val('2+*3').startsWith('ERR:'), true, 'bad syntax'); eq(val('foo(1)'), 'ERR:Unknown function "foo"', 'unknown function'); eq(val('x1'), 'ERR:Unknown name "x1"', 'unknown name');
eq(val('(1+2'), 'ERR:Expected ")"', 'missing bracket'); eq(String(val('1 2')).startsWith('ERR:'), true, 'two bare numbers side by side is an error (not a silent product)'); eq(String(val('1 000')).startsWith('ERR:'), true, '"1 000" is an error, not 0'); eq(C('').ok, false, 'empty is not an error message'); eq(C('').error, '', 'empty has no message');
eq(val('9'.repeat(400)), 'ERR:Too long', 'length limit'); eq(val('('.repeat(80) + '1' + ')'.repeat(80)), 'ERR:Too deeply nested', 'nesting limit (no stack overflow)'); eq(val('10^400'), 'ERR:Result too large', 'overflow');
eq(val('require("fs")').startsWith('ERR:'), true, 'no code execution'); eq(val('process.exit()').startsWith('ERR:'), true, 'no code execution (2)'); eq(val('constructor').startsWith('ERR:'), true, 'no prototype lookups'); eq(val('__proto__').startsWith('ERR:'), true, 'no prototype lookups (2)');
eq(T.groupNumber('1234567.89'), '1,234,567.89', 'grouping'); eq(T.groupNumber('-1234'), '-1,234', 'grouping negative'); eq(T.groupNumber('12'), '12', 'small number'); eq(T.formatNumber(1e21), '1e21', 'huge number exponent'); eq(T.formatNumber(0.00000001), '1e-8', 'tiny number exponent');

/* ---------- unit converter ---------- */
const cv = (cat, a, b, v, rt) => T.convert(cat, a, b, v, rt);
near(cv('length', 'km', 'mi', 1), 0.621371192, 'km -> mi', 1e-8); near(cv('length', 'in', 'cm', 1), 2.54, 'in -> cm'); near(cv('length', 'ft', 'm', 6), 1.8288, 'ft -> m'); near(cv('length', 'mi', 'km', 26.2), 42.1648, '26.2 mi -> km', 1e-5);
near(cv('weight', 'kg', 'lb', 1), 2.20462262, 'kg -> lb', 1e-8); near(cv('weight', 'lb', 'kg', 150), 68.0388555, 'lb -> kg'); near(cv('weight', 'oz', 'g', 1), 28.349523125, 'oz -> g'); near(cv('weight', 'quintal', 'kg', 2), 200, 'quintal'); near(cv('weight', 'tola', 'g', 10), 116.638038, 'tola');
near(cv('temperature', 'c', 'f', 100), 212, '100C = 212F'); near(cv('temperature', 'f', 'c', 32), 0, '32F = 0C'); near(cv('temperature', 'c', 'k', 0), 273.15, '0C = 273.15K'); near(cv('temperature', 'f', 'c', -40), -40, '-40 is -40'); near(cv('temperature', 'k', 'f', 0), -459.67, '0K = -459.67F', 1e-9);
const RATES = { base: 'USD', rates: { INR: 84, EUR: 0.9, JPY: 150 } };
near(cv('currency', 'USD', 'INR', 10, RATES), 840, 'USD -> INR'); near(cv('currency', 'INR', 'USD', 840, RATES), 10, 'INR -> USD'); near(cv('currency', 'EUR', 'INR', 9, RATES), 840, 'cross rate EUR -> INR'); ok(Number.isNaN(cv('currency', 'USD', 'XXX', 1, RATES)) && Number.isNaN(cv('currency', 'USD', 'INR', 1, null)), 'unknown currency / no rates = NaN');
let p = T.parseConversion('5 km to mi'); ok(p.ok && p.cat === 'length' && Math.abs(p.result - 3.10686) < 1e-4, 'free text: 5 km to mi'); p = T.parseConversion('72 f to c'); ok(p.ok && Math.abs(p.result - 22.2222) < 1e-3, '72 f to c');
p = T.parseConversion('100 usd in inr', RATES); ok(p.ok && p.cat === 'currency' && p.result === 8400, '100 usd in inr'); p = T.parseConversion('2 pounds to kg'); ok(p.ok && p.cat === 'weight' && Math.abs(p.result - 0.907) < 1e-3, '"pounds" next to kg = weight'); p = T.parseConversion('50 pounds to inr', RATES.rates.GBP ? RATES : { base: 'USD', rates: { INR: 84, GBP: 0.8 } }); ok(p.ok && p.cat === 'currency', '"pounds" next to inr = sterling');
p = T.parseConversion('1,500 g to kg'); ok(p.ok && p.result === 1.5, 'thousands separator in free text'); p = T.parseConversion('3 miles into kilometers'); ok(p.ok && Math.abs(p.result - 4.828) < 1e-3, 'words: miles into kilometers'); p = T.parseConversion('5 kg to km'); ok(!p.ok, 'incompatible units fail'); p = T.parseConversion('hello'); ok(!p.ok, 'non-conversion text');
p = T.parseConversion('₹500 to usd', RATES); ok(!p.ok || p.cat === 'currency', 'currency symbol input does not crash');
eq(T.formatConv(1234.5678), '1,234.568', 'format >1000 grouped, 7 sig digits'); eq(T.formatConv(0.000123456789), '0.0001234568', 'format small'); eq(T.formatConv(3.1068559611), '3.106856', 'format 7 sig'); eq(T.formatConv(NaN), '—', 'format NaN');

/* ---------- batch rename ---------- */
const F = (names, dir = 'C:\\Pics') => names.map((n, i) => ({ path: dir + '\\' + n, mtime: new Date(2026, 5, 1 + i, 10, 30).getTime() }));
const names = (res) => res.items.map((x) => x.newName);
eq(names(T.planRename(F(['a b.jpg', 'c d.PNG']), { spaces: 'underscore' })), ['a_b.jpg', 'c_d.PNG'], 'spaces -> underscores, extension untouched');
eq(names(T.planRename(F(['IMG_1.jpg', 'IMG_2.jpg']), { find: 'IMG_', replace: 'Holiday ' })), ['Holiday 1.jpg', 'Holiday 2.jpg'], 'find / replace');
eq(names(T.planRename(F(['x.txt', 'y.txt']), { base: 'custom', custom: 'Report', num: true, numStart: 1, numPad: 3 })), ['Report 001.txt', 'Report 002.txt'], 'custom name + numbering');
eq(names(T.planRename(F(['x.txt', 'y.txt']), { num: true, numStart: 10, numStep: 5, numPad: 0, numPos: 'prefix', numSep: '_' })), ['10_x.txt', '15_y.txt'], 'numbering prefix, start, step');
eq(names(T.planRename(F(['Hello World.TXT']), { caseMode: 'upper' })), ['HELLO WORLD.TXT'], 'upper-case name (extension untouched)'); eq(names(T.planRename(F(['hello big WORLD.txt']), { caseMode: 'title' })), ['Hello Big World.txt'], 'title case'); eq(names(T.planRename(F(['HELLO WORLD.txt']), { caseMode: 'sentence' })), ['Hello world.txt'], 'sentence case');
eq(names(T.planRename(F(['a.jpg', 'b.jpg']), { date: 'prefix' })), ['2026-06-01 a.jpg', '2026-06-02 b.jpg'], 'date prefix from modified time'); eq(names(T.planRename(F(['a.jpg']), { date: 'suffix', dateFormat: 'YYYYMMDD_HHmm' })), ['a 20260601_1030.jpg'], 'date suffix with custom format');
eq(names(T.planRename(F(['a.jpg']), { prefix: 'pre_', suffix: '_post' })), ['pre_a_post.jpg'], 'prefix + suffix'); eq(names(T.planRename(F(['photo (1).jpg']), { find: '\\s*\\(\\d+\\)', replace: '', regex: true })), ['photo.jpg'], 'regex'); eq(names(T.planRename(F(['2026-05-01 a.jpg']), { find: '(\\d+)-(\\d+)-(\\d+)', replace: '$3.$2.$1', regex: true })), ['01.05.2026 a.jpg'], 'regex capture groups');
eq(names(T.planRename(F(['a.JPG']), { find: 'A', replace: 'z' })), ['z.JPG'], 'find is case-insensitive by default'); eq(names(T.planRename(F(['aA.jpg']), { find: 'A', replace: 'z', matchCase: true })), ['az.jpg'], 'match case');
eq(names(T.planRename(F(['price.txt']), { find: 'price', replace: '$5' })), ['$5.txt'], 'a literal $ in the replacement text is kept (plain mode)');
eq(names(T.planRename(F(['archive.tar.gz', '.gitignore', 'noext']), { prefix: 'x_' })), ['x_archive.tar.gz', 'x_.gitignore', 'x_noext'], 'double extension / dotfile / no extension');
let pl = T.planRename(F(['a.txt', 'b.txt']), { base: 'custom', custom: 'same' }); eq(pl.items.map((i) => i.status), ['ok', 'dup'], 'two files with one target name: second is flagged'); ok(!pl.canApply, '... and the batch cannot be applied');
pl = T.planRename(F(['a.txt', 'b.txt']), { find: 'a', replace: 'b' }); ok(pl.items[0].status === 'dup', 'renaming a.txt -> b.txt while b.txt stays unchanged is a clash');
pl = T.planRename(F(['a.txt', 'b.txt']), { find: '[ab]', replace: 'c', regex: true }); ok(pl.items.every((i) => i.status === 'dup' || i.status === 'ok') && pl.bad === 1, 'a and b both -> c: one flagged');
pl = T.planRename(F(['a.txt', 'b.txt']), { find: 'a', replace: 'b', regex: false }, new Set()); ok(pl.bad >= 1, 'chain clash detected');
pl = T.planRename(F(['a.txt']), { base: 'custom', custom: 'taken' }, new Set(['c:\\pics\\taken.txt'])); eq(pl.items[0].status, 'exists', 'target already exists on disk');
pl = T.planRename(F(['a.txt', 'b.txt']), { find: 'a', replace: 'b' }, new Set(['c:\\pics\\b.txt', 'c:\\pics\\a.txt'])); ok(pl.items[0].status === 'dup', 'unchanged b.txt still blocks a rename onto it');
pl = T.planRename(F(['A.txt']), { caseMode: 'lower' }, new Set(['c:\\pics\\a.txt'])); eq(pl.items[0].status, 'ok', 'case-only rename of a file onto itself is allowed');
pl = T.planRename(F(['a.txt', 'b.txt']), { find: 'a', replace: 'x' }); eq([pl.items[0].status, pl.items[1].status, pl.ok, pl.same], ['ok', 'same', 1, 1], 'unchanged files are reported as same');
pl = T.planRename(F(['a.txt']), { prefix: 'a/b' }); eq(pl.items[0].status, 'invalid', 'slash in a name is refused'); pl = T.planRename(F(['a.txt']), { prefix: 'x?' }); eq(pl.items[0].status, 'invalid', '? is refused');
pl = T.planRename(F(['a.txt']), { base: 'custom', custom: 'CON' }); eq(pl.items[0].status, 'invalid', 'reserved name CON'); pl = T.planRename(F(['a.txt']), { base: 'custom', custom: 'nul.backup' }); eq(pl.items[0].status, 'invalid', 'reserved name NUL.backup');
pl = T.planRename(F(['a.txt']), { find: 'a', replace: '' }); eq(pl.items[0].status, 'invalid', 'empty name refused'); pl = T.planRename(F(['a.txt']), { find: '(', replace: '', regex: true }); eq(pl.items[0].status, 'invalid', 'bad regex reported, not thrown');
pl = T.planRename(F(['a.txt']), { suffix: ' ...' }); eq(pl.items[0].newName, 'a.txt', 'trailing dots and spaces in the name part are trimmed'); pl = T.planRename(F(['a.txt']), { prefix: 'x'.repeat(250) }); eq(pl.items[0].status, 'invalid', 'over-long name refused');
pl = T.planRename(F(['a.exe']), { find: 'a', replace: 'b' }); eq(pl.items[0].newName, 'b.exe', 'extension can never change'); pl = T.planRename(F(['a.txt']), { base: 'custom', custom: 'evil.exe' }); eq(pl.items[0].newName, 'evil.exe.txt', 'a typed ".exe" ends up inside the name, the real extension stays .txt');
eq(T.planRename(Array.from({ length: 600 }, (_, i) => ({ path: 'C:\\x\\' + i + '.txt' })), {}).items.length, 500, 'batch limit 500'); eq(T.planRename([], {}).canApply, false, 'empty batch');
pl = T.planRename(F(['a.txt', 'b.txt'], 'C:\\One').concat(F(['a.txt'], 'C:\\Two')), { base: 'custom', custom: 'n' }); eq(pl.items.map((i) => i.status), ['ok', 'dup', 'ok'], 'same new name in different folders is fine');

/* ---------- QR payloads ---------- */
eq(T.wifiPayload({ ssid: 'Home', pass: 'secret', auth: 'WPA' }), 'WIFI:T:WPA;S:Home;P:secret;;', 'wifi payload'); eq(T.wifiPayload({ ssid: 'My;Net', pass: 'a:b,c\\d"e', auth: 'WPA', hidden: true }), 'WIFI:T:WPA;S:My\\;Net;P:a\\:b\\,c\\\\d\\"e;H:true;;', 'wifi payload escapes ; : , \\ "'); eq(T.wifiPayload({ ssid: 'Cafe', auth: 'nopass' }), 'WIFI:T:nopass;S:Cafe;;', 'open wifi');
eq(T.vcardPayload({ name: 'Ravi K', phone: '+91 98765 43210', email: 'r@x.com' }), 'BEGIN:VCARD\nVERSION:3.0\nFN:Ravi K\nTEL:+91 98765 43210\nEMAIL:r@x.com\nEND:VCARD', 'vCard');
eq(T.qrPayload('phone', { text: '+91 98765-43210' }), 'tel:+919876543210', 'tel link'); eq(T.qrPayload('email', { text: ' a@b.com ' }), 'mailto:a@b.com', 'mailto'); eq(T.qrPayload('text', { text: 'hi' }), 'hi', 'plain text'); eq(T.qrPayload('wifi', {}), '', 'wifi without ssid = nothing');

/* ---------- window layout geometry ---------- */
const W = { x: 0, y: 0, w: 1920, h: 1040 };
eq(T.zoneRect('left', W), { x: 0, y: 0, w: 960, h: 1040 }, 'left half'); eq(T.zoneRect('right', W), { x: 960, y: 0, w: 960, h: 1040 }, 'right half'); eq(T.zoneRect('br', W), { x: 960, y: 520, w: 960, h: 520 }, 'bottom-right quarter');
eq(T.zoneRect('third3', { x: 0, y: 0, w: 1000, h: 500 }), { x: 666, y: 0, w: 334, h: 500 }, 'last third takes the remainder pixel(s)'); eq(T.zoneRect('max', W), { max: true }, 'maximise'); eq(T.zoneRect('nope', W), null, 'unknown zone');
const W2 = { x: 1920, y: 40, w: 1280, h: 984 }; eq(T.zoneRect('left', W2), { x: 1920, y: 40, w: 640, h: 984 }, 'second monitor offset is respected');
for (const z of T.ZONES.filter((z) => z !== 'max')) { const r = T.zoneRect(z, W2); ok(r && r.x >= W2.x && r.y >= W2.y && r.x + r.w <= W2.x + W2.w && r.y + r.h <= W2.y + W2.h && r.w > 0 && r.h > 0, 'zone ' + z + ' stays inside the work area'); }
ok(T.LAYOUTS.every((l) => l.zones.every((z) => T.ZONES.includes(z))), 'every layout uses known zones');
const tile = (l) => { const rs = l.zones.map((z) => T.zoneRect(z, W)); const area = rs.reduce((a, r) => a + (r.max ? W.w * W.h : r.w * r.h), 0); return area; };
ok(T.LAYOUTS.filter((l) => l.id !== 'focus').every((l) => tile(l) === W.w * W.h), 'preset layouts tile the whole work area without gaps (areas add up)');
const rel = T.relRect({ x: 480, y: 260, w: 960, h: 520 }, W); eq(T.absRect(rel, { x: 0, y: 0, w: 2560, h: 1400 }), { x: 640, y: 350, w: 1280, h: 700 }, 'saved layout scales to another resolution');

/* ---------- sanitisers ---------- */
ok(T.sanitizeFolder({ path: 'C:\\Users\\me\\Downloads' }).name === 'Downloads' && T.sanitizeFolder({ path: 'D:/Work/' }).name === 'Work', 'folder name defaults to the last part of the path');
ok(!T.sanitizeFolder({ path: '\\\\server\\share' }) && !T.sanitizeFolder({ path: 'relative\\dir' }) && !T.sanitizeFolder({ path: 'C:\\a:b' }) && !T.sanitizeFolder({ path: 'C:\\a\0b' }) && !T.sanitizeFolder(null), 'folder shortcuts refuse UNC, relative, stream and NUL paths');
eq(T.sanitizeFolders([{ path: 'C:\\A' }, { path: 'c:\\a' }, { path: 'C:\\B' }]).length, 2, 'duplicate folders (any case) dropped');
eq(T.sanitizeFavs(['Chrome', { name: 'chrome' }, '', { name: 'Notepad' }]).map((a) => a.name), ['Chrome', 'Notepad'], 'favourite apps: names, no duplicates');
ok(T.sanitizeLayout({ name: 'Work', items: [{ proc: 'chrome', mon: 0, x: 0, y: 0, w: 0.5, h: 1 }, { proc: '', x: 0 }] }).items.length === 1 && !T.sanitizeLayout({ name: '', items: [{ proc: 'a' }] }) && !T.sanitizeLayout({ name: 'x', items: [] }), 'layout sanitiser');
eq(T.sanitizeCalcHistory([{ e: '1+1', r: '2' }, { e: '', r: '3' }, null]).length, 1, 'calc history sanitiser');
eq(T.fmtBytes(500) + '|' + T.fmtBytes(2048) + '|' + T.fmtBytes(5 * 1048576), '500 B|2 KB|5.0 MB', 'fmtBytes');

/* ---------- task manager: grouping + protection ---------- */
{
  const rows = [{ pid: 10, name: 'chrome', title: 'GitHub', mem: 5e8, path: 'C:/c/chrome.exe', desc: 'Google Chrome' }, { pid: 11, name: 'chrome', title: '', mem: 3e8 }, { pid: 12, name: 'Chrome', title: '', mem: 1e8 },
    { pid: 20, name: 'svchost', title: '', mem: 1e7 }, { pid: 30, name: 'explorer', title: 'Downloads', mem: 1e8 }, { pid: 4, name: 'System', mem: 1e6 }, { pid: 40, name: 'powershell', mem: 1e7 }, { pid: 41, name: 'powershell', title: 'PS', mem: 2e7 }, { pid: 50, name: 'OneDrive', mem: 9e7 }, null, { pid: 'x', name: 'bad' }];
  const g = T.groupProcs(rows, new Set([40]));
  eq(g.apps.map((a) => a.id), ['chrome', 'explorer', 'powershell'], 'programs with a window are apps, biggest memory first (case-insensitive names merge)');
  eq(g.apps[0].pids, [10, 11, 12], 'all processes of an app end together'); eq(g.apps[0].mem, 9e8, 'memory is summed'); eq(g.apps[0].name, 'Google Chrome', 'friendly name from the file description');
  eq(g.bg.map((a) => a.id), ['onedrive', 'svchost'], 'no window = background'); eq(g.apps[2].pids, [41], "the island's own helper pid is never included");
  ok(!g.apps.concat(g.bg).some((x) => x.pids.includes(4)), 'pid 4 (System) is never listed');
  ok(g.apps.find((a) => a.id === 'explorer').protected && g.bg.find((a) => a.id === 'svchost').protected && !g.apps[0].protected, 'Windows itself is protected, normal apps are not');
  ok(T.procIsProtected('Explorer.exe') && T.procIsProtected('CSRSS') && T.procIsProtected('winlogon') && !T.procIsProtected('notepad'), 'protection ignores case and .exe');
  const known = new Map(g.apps.concat(g.bg).map((x) => [x.id, x]));
  eq(T.procTargets(['chrome', 'chrome', 'nope'], known).items, [{ pid: 10, name: 'chrome' }, { pid: 11, name: 'chrome' }, { pid: 12, name: 'chrome' }], 'targets come only from the last listing, once each');
  const t2 = T.procTargets(['explorer', 'svchost'], known); eq(t2.items, [], 'protected programs are never targeted'); eq(t2.skipped.length, 2, 'and are reported as skipped');
  eq(T.procTargets('chrome', known).items, [], 'non-array input is harmless'); eq(T.groupProcs(null, null), { apps: [], bg: [] }, 'bad input gives empty lists');
  eq([T.fmtMem(812e6), T.fmtMem(2.5e9), T.fmtMem(2000)], ['774 MB', '2.33 GB', '2 KB'], 'memory formatting');
}

console.log(f ? '\n' + f + ' TOOLS TEST(S) FAILED' : '\nTOOLS TESTS PASSED'); process.exit(f ? 1 : 0);
