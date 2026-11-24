const Module=require('module'),fs=require('fs'),os=require('os'),path=require('path');
const ud=fs.mkdtempSync(path.join(os.tmpdir(),'ud-'));
const handlers={},ons={},opened=[],pathsOpened=[],wins=[];
const fakeSS={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('D:'+s),decryptString:b=>b.toString().slice(2)};
const wcStub=()=>({send(){},on(){},setWindowOpenHandler(){},getURL:()=>'file:///x/index.html',session:{},setUserAgent(){},userAgent:'',executeJavaScript:async()=>false,isDestroyed:()=>false});
class BW{constructor(o){this.o=o;this.webContents=wcStub();wins.push(this)}loadFile(){}loadURL(){return Promise.resolve()}setAlwaysOnTop(){}setContentProtection(){}setIgnoreMouseEvents(){}once(_,f){}on(){}show(){}focus(){}hide(){}showInactive(){}isVisible(){return true}removeMenu(){}isDestroyed(){return false}static getAllWindows(){return wins}}
const lifecycle={};
const electron={app:{on(e,f){lifecycle[e]=f},whenReady:()=>Promise.resolve(),getPath:()=>ud,requestSingleInstanceLock:()=>true,exit(){},setPath(){},quit(){},setLoginItemSettings(){},getLoginItemSettings(){return{openAtLogin:false}},setAppUserModelId(){},commandLine:{appendSwitch(){}}},
 BrowserWindow:BW,ipcMain:{handle:(c,f)=>handlers[c]=f,on:(c,f)=>ons[c]=f},screen:{getPrimaryDisplay:()=>({bounds:{x:0,y:0,width:1920,height:1080},workArea:{height:1040}})},
 shell:{openExternal:u=>opened.push(u),openPath:p=>pathsOpened.push(p),showItemInFolder(){}},globalShortcut:{register:()=>true,unregisterAll(){}},desktopCapturer:{},nativeImage:{createFromPath:()=>({isEmpty:()=>true,resize(){return this}})},Tray:class{setToolTip(){}on(){}popUpContextMenu(){}},Menu:{buildFromTemplate:t=>t},Notification:class{static isSupported(){return false}},
 session:{defaultSession:{setPermissionRequestHandler(f){electron._perm=f},setPermissionCheckHandler(){}}},powerMonitor:{on(e,f){electron['_pm_'+e]=f}},safeStorage:fakeSS};
const orig=Module._load;Module._load=function(r,...a){if(r==='electron')return electron;if(r==='child_process')return{spawn:()=>({stdout:{on(){},setEncoding(){}},stderr:{on(){},setEncoding(){}},stdin:{write(){},on(){}},on(){},kill(){}}),exec(){},execFile(){}};return orig.call(this,r,...a)};
let f=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)f++};
process.env.APPDATA=path.join(ud,'AppData');
require('../dynamic-island/main.js');
setTimeout(async()=>{
 const good={senderFrame:{url:'file:///app/settings.html'},sender:{getURL:()=>'file:///app/settings.html'}};
 const bad={senderFrame:{url:'https://evil.example/'},sender:{getURL:()=>'https://evil.example/'}};
 ok(!!handlers['vault:status']&&!!handlers['settings:set'],'handlers registered, startup did not throw');
 ok(handlers['vault:status'](bad)===null&&handlers['vault:status'](good).cipher==='AES-256-GCM','vault status only for app pages');
 let db=await handlers['settings:set'](good,{theme:'light',evilKey:1,__proto__x:2,aiProvider:'hack'});
 ok(db.settings.theme==='light'&&!('evilKey' in db.settings)&&db.settings.aiProvider!=='hack','settings whitelist + provider validation');
 const before=JSON.stringify((await handlers['db:get']()).settings);await handlers['settings:set'](bad,{theme:'dark'});ok(JSON.stringify((await handlers['db:get']()).settings)===before,'untrusted page cannot change settings');
 const r=await handlers['ai:connect'](bad,'claude','sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx');ok(!r.ok&&/Blocked/.test(r.text),'untrusted page cannot connect a key');
 const M=require('../dynamic-island/main.js'),AD='C:\\Users\\me\\AppData\\Roaming',chk=p=>M.checkOpenPath(p,AD);
 const blocked=['C:\\Users\\me\\malware.exe','C:\\Users\\me\\run.ps1','C:\\Users\\me\\RUN.BAT','C:\\Users\\me\\a.exe.','C:\\Users\\me\\a.exe ','C:\\Users\\me\\a.pdf:evil.exe','C:\\Users\\me\\x.lnk',
  'C:\\Users\\me\\..\\..\\Temp\\evil.cmd','C:/Users/me/evil.vbs','\\\\server\\share\\a.pdf','//server/share/a.pdf','\\\\?\\C:\\a.pdf','relative\\a.pdf','a.pdf','C:\\a\0.pdf',5,null,'C:\\'+'x'.repeat(1100)+'.pdf',
  AD+'\\Microsoft\\Windows\\Recent\\evil.exe',AD+'\\Microsoft\\Windows\\Recent\\..\\..\\..\\..\\x.lnk'];
 ok(blocked.every(p=>chk(p)===null),'checkOpenPath refuses programs, scripts, UNC/device, streams, trailing dots, relative, traversal (Windows rules, any host)');
 ok(chk('C:\\Users\\me\\report.pdf')==='C:\\Users\\me\\report.pdf'&&chk('C:/Users/me/photo.JPG')==='C:\\Users\\me\\photo.JPG'&&chk('D:\\Docs\\notes.txt')==='D:\\Docs\\notes.txt','checkOpenPath allows documents and photos (positive control)');
 ok(chk(AD+'\\Microsoft\\Windows\\Recent\\Report.lnk')===AD+'\\Microsoft\\Windows\\Recent\\Report.lnk'&&chk(AD.toLowerCase()+'\\microsoft\\windows\\recent\\r.LNK')!==null,'shortcuts allowed only inside the Recent folder');
 ons['open-path'](good,'C:\\Users\\me\\malware.exe');ons['open-path'](good,'C:\\Users\\me\\run.ps1');ons['open-path'](good,'\\\\server\\share\\a.pdf');ons['open-path'](bad,'C:\\Users\\me\\a.pdf');
 ok(pathsOpened.length===0,'IPC: programs, scripts, UNC paths and untrusted callers refused');
 ons['open-path'](good,'C:\\Users\\me\\a.pdf');ok(pathsOpened.length===1&&pathsOpened[0]==='C:\\Users\\me\\a.pdf','IPC: a normal document from an app page does open');
 // ---- screenshot options ----
 ok(JSON.stringify(M.shotPlan({mode:'collapsed',delay:'5'}))==='{"mode":"collapsed","delay":5}'&&JSON.stringify(M.shotPlan({mode:'evil',delay:99}))==='{"mode":"hidden","delay":10}'&&JSON.stringify(M.shotPlan({delay:-4}))==='{"mode":"hidden","delay":0}'&&M.shotPlan({delay:'abc'}).delay===0&&M.shotPlan().mode==='hidden','shotPlan: validates mode, clamps delay 0-10');
 const dbS=await handlers['settings:set'](good,{shotMode:'collapsed',shotDelay:'3'});ok(dbS.settings.shotMode==='collapsed'&&dbS.settings.shotDelay===3,'screenshot mode/delay saved from Settings (string -> number)');
 const dbH=await handlers['settings:set'](good,{hiddenSlides:['music','home','bogus','music','news']});ok(JSON.stringify(dbH.settings.hiddenSlides)==='["music","news"]','hiddenSlides keeps only known slides, never Home, no duplicates');
 const dbH2=await handlers['settings:set'](good,{hiddenSlides:'x'});ok(Array.isArray(dbH2.settings.hiddenSlides)&&!dbH2.settings.hiddenSlides.length,'bad hiddenSlides becomes empty');
 const dbO=await handlers['settings:set'](good,{slideOrder:['news','home','bogus','music','news']});ok(JSON.stringify(dbO.settings.slideOrder)==='["news","music"]','slideOrder keeps only known slides, no Home, no duplicates');
 const dbD=await handlers['settings:set'](good,{dateFormat:'ymd'});ok(dbD.settings.dateFormat==='ymd','date format saved');
 const dbD2=await handlers['settings:set'](good,{dateFormat:'bogus'});ok(dbD2.settings.dateFormat==='auto','bad date format falls back to auto');
 const dbS2=await handlers['settings:set'](good,{shotMode:'zzz',shotDelay:500});ok(dbS2.settings.shotMode==='hidden'&&dbS2.settings.shotDelay===10,'bad screenshot settings are sanitised');
 electron.screen.getPrimaryDisplay=()=>({id:1,scaleFactor:1,size:{width:1920,height:1080},bounds:{x:0,y:0,width:1920,height:1080},workArea:{height:1040}});
 electron.desktopCapturer.getSources=async()=>[{display_id:'1',thumbnail:{toPNG:()=>Buffer.from('PNGDATA')}}];
 const isl=wins.find(w=>w.o&&w.o.alwaysOnTop),log=[];
 isl.hide=()=>log.push('hide');isl.showInactive=()=>log.push('show');isl.setContentProtection=v=>log.push('protect:'+v);
 const bs=await handlers['capture:screen'](bad,{mode:'hidden'});ok(!bs.ok&&log.length===0,'untrusted page cannot take screenshots');
 const s1=await handlers['capture:screen'](good,{mode:'hidden',delay:0});
 ok(s1.ok&&s1.mode==='hidden'&&fs.existsSync(s1.path)&&fs.readFileSync(s1.path).toString()==='PNGDATA'&&log.join()==='hide,protect:true,show','"Without island": window hidden for the shot, then protection + window restored, file saved');
 log.length=0;const s2=await handlers['capture:screen'](good,{mode:'collapsed',delay:0});
 ok(s2.ok&&s2.mode==='collapsed'&&log.join()==='protect:false,protect:true','"Collapsed island": protection off only during the shot, window stays, protection restored');
 electron.desktopCapturer.getSources=async()=>{throw new Error('boom')};log.length=0;
 const s3=await handlers['capture:screen'](good,{mode:'hidden',delay:0});ok(!s3.ok&&log.join()==='hide,protect:true,show','a failed capture still restores the island');
 electron.desktopCapturer.getSources=async()=>[{display_id:'1',thumbnail:{toPNG:()=>Buffer.from('x')}}];
 const s4=await handlers['capture:screen'](good);ok(s4.ok&&s4.mode==='hidden','no options: falls back to the saved mode');
 const w=await handlers['vault:set-passphrase'](good,'Tr0ub4dor&3-horse','');ok(w.ok&&w.status.mode==='passphrase','set passphrase over IPC');
 electron['_pm_lock-screen']();ok(handlers['vault:status'](good).locked,'Windows lock-screen locks the vault');
 const u=await handlers['vault:unlock'](good,'nope-nope-nope');ok(!u.ok,'wrong passphrase over IPC');
 ok(await new Promise(r=>electron._perm({getURL:()=>'https://x.com'},'geolocation',r))===false&&await new Promise(r=>electron._perm({getURL:()=>'file:///a/index.html'},'media',r))===true,'permissions: media for app only');
 /* productivity: Quick Capture, sanitised data, repeating tasks, new data kinds */
 const cap=await handlers['capture:add'](good,'Call supplier at 4 PM');ok(cap.ok&&cap.kind==='task'&&cap.task.text==='Call supplier'&&cap.task.cat==='work'&&cap.task.due>0,'Quick Capture adds a parsed task');
 ok(!(await handlers['capture:add'](bad,'Evil')).ok&&!(await handlers['capture:add'](good,'   ')).ok,'capture refuses untrusted pages and empty text');
 const idea=await handlers['capture:add'](good,'idea: kuli booking app');ok(idea.ok&&idea.kind==='idea','"idea:" goes to the journal');
 const exp=await handlers['capture:add'](good,'spent 250 on lunch');ok(exp.ok&&exp.kind==='expense','"spent 250 on lunch" is an expense');
 db=await handlers['db:get']();ok(db.journal.length===1&&db.journal[0].kind==='idea'&&db.expenses.length===1&&db.expenses[0].amount===250&&db.expenses[0].cat==='Food','idea and expense stored');
 db=await handlers['data:set'](good,{tasks:[{id:'z1',text:'Bad fields',cat:'hax',pri:'x',repeat:'yearly',date:'tomorrow',cond:'rm -rf'},...db.tasks]});
 const z=db.tasks.find(t=>t.id==='z1');ok(z.cat==='personal'&&z.pri==='normal'&&z.repeat==='none'&&z.date===null&&z.cond==='none','saved tasks are sanitised');
 db=await handlers['data:set'](good,{tasks:[{id:'r1',text:'Standup',repeat:'daily',date:'2026-01-05',cat:'work',done:false},...db.tasks]});
 db=await handlers['data:set'](good,{tasks:db.tasks.map(t=>t.id==='r1'?{...t,done:true}:t)});
 ok(db.tasks.find(t=>t.id==='r1').doneAt>0&&db.tasks.filter(t=>t.text==='Standup'&&!t.done).length===1,'ticking a repeating task creates its next copy');
 db=await handlers['data:set'](good,{tasks:db.tasks,habits:[{id:'h1',name:'Read',days:['2026-11-20','junk']},{name:''}],goals:[{id:'g1',text:'Water',target:8,log:{'2026-11-20':3}}],expenses:[{amount:-5},{id:'e1',amount:10,cat:'zzz'}],journal:[{text:'x'.repeat(9000)}]});
 ok(db.habits.length===1&&db.habits[0].days.length===1&&db.goals[0].target===8&&db.expenses.length===1&&db.expenses[0].cat==='Other'&&db.journal[0].text.length===4000,'habits, goals, expenses and journal are sanitised');
 const bd=JSON.stringify(await handlers['db:get']());await handlers['data:set'](bad,{habits:[]});ok(JSON.stringify(await handlers['db:get']())===bd,'untrusted page cannot change planner data');
 db=await handlers['settings:set'](good,{captureShortcut:'Control+Alt+J',aiAssist:'nope',currency:'$$$$$$$'});ok(db.settings.captureShortcut==='Control+Alt+J'&&db.settings.aiAssist==='cloud'&&db.settings.currency.length<=4,'capture shortcut, AI assist and currency settings validated');
 db=await handlers['settings:set'](good,{hiddenSlides:['planner','bogus']});ok(db.settings.hiddenSlides.length===1&&db.settings.hiddenSlides[0]==='planner','new slide ids accepted in hiddenSlides');
 /* smart assistant */
 ok(!!handlers['assist:ask']&&!!handlers['assist:act']&&!!handlers['assist:meeting-finish'],'assistant handlers registered');
 ok((await handlers['assist:ask'](bad,"what's pending today")).reply==='Blocked.'&&(await handlers['assist:act'](bad,'k1')).reply==='Blocked.'&&!(await handlers['assist:remember'](bad,'I like tea')).ok,'untrusted pages cannot use the assistant');
 const as1=await handlers['assist:ask'](good,"what's pending today");ok(as1.ok&&/pending|nothing pending/i.test(as1.reply),'assistant answers a pending question');
 const as2=await handlers['assist:ask'](good,'delete everything about nothing');ok(as2.ok===true||as2.ok===false,'assistant never throws on odd input');
 db=await handlers['settings:set'](good,{assistWorkStart:'600',assistWorkEnd:300,assistDefMin:9999,assistBrief:'x',assistBriefDate:'hack',voiceShortcut:'Control+Alt+J'});
 ok(db.settings.assistWorkStart===540&&db.settings.assistDefMin===240&&db.settings.assistBrief==='first'&&db.settings.assistBriefDate!=='hack','assistant settings validated (hours must end after they start)');
 db=await handlers['data:set'](good,{memory:[{text:'I prefer mornings',kind:'preference'},{text:'x'},{text:'Work 9-5',kind:'work',start:900,end:100}],meetings:[{title:'Sync',summary:'ok',transcript:'y'.repeat(70000),actions:[{text:'Send it'},{text:''}]}]});
 ok(db.memory.length===2&&db.memory[1].kind==='fact'&&db.meetings[0].transcript.length===60000&&db.meetings[0].actions.length===1,'memory and meetings are sanitised');
 const bd2=JSON.stringify((await handlers['db:get']()).memory);await handlers['data:set'](bad,{memory:[]});ok(JSON.stringify((await handlers['db:get']()).memory)===bd2,'untrusted page cannot change memory');
 const rem=await handlers['assist:remember'](good,'I prefer meetings after 11');ok(rem.ok&&(await handlers['db:get']()).memory.length===3,'Settings can add a memory');
 db=await handlers['settings:set'](good,{hiddenSlides:['assistant']});ok(db.settings.hiddenSlides[0]==='assistant','assistant slide can be hidden in Menus');
 // ---- network speed + version
 ok(!!handlers['speed:live']&&!!handlers['speed:start']&&!!handlers['speed:cancel']&&!!handlers['speed:clear']&&!!handlers['app:info'],'speed and app-info handlers registered');
 ok((await handlers['speed:live'](bad))===null&&(await handlers['speed:start'](bad)).error==='Blocked.'&&(await handlers['app:info'](bad))===null,'untrusted pages cannot use speed or version handlers');
 const inf=await handlers['app:info'](good);ok(inf&&inf.version===require('../dynamic-island/package.json').version&&/^\d+\.\d+\.\d+$/.test(inf.version),'app:info reports the package.json version ('+(inf&&inf.version)+')');
 db=await handlers['data:set'](good,{speedTests:[{t:5,down:50,up:10,ping:20},{t:9,down:-1,up:'x'},{bad:1}]});ok(db.speedTests.length===2&&db.speedTests[0].t===9&&db.speedTests[0].down===0,'speedTests from the page are sanitised');
 const bst=JSON.stringify((await handlers['db:get']()).speedTests);await handlers['data:set'](bad,{speedTests:[]});ok(JSON.stringify((await handlers['db:get']()).speedTests)===bst,'untrusted page cannot change speed history');
 db=await handlers['speed:clear'](good);ok(db.speedTests.length===0,'speed history can be cleared');
 db=await handlers['settings:set'](good,{speedSeeded:false,lastRunVersion:'0.0.1',hiddenSlides:['speed','news']});ok(db.settings.speedSeeded===true&&db.settings.lastRunVersion!=='0.0.1'&&db.settings.hiddenSlides.includes('speed'),'internal flags cannot be set from a page; the speed slide is a known slide that can be hidden');
 db=await handlers['settings:set'](good,{slideOrder:['speed','connect']});ok(JSON.stringify(db.settings.slideOrder)==='["speed","connect"]','speed slide can be reordered');
 console.log(f?f+' FAILED':'ALL MAIN-PROCESS TESTS PASSED');process.exit(f?1:0)},1500);
