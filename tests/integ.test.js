const Module=require('module'),fs=require('fs'),os=require('os'),path=require('path');
const orig=Module._load;
Module._load=function(r,...a){if(r==='electron')return{app:{on(){},getPath:()=>os.tmpdir()},BrowserWindow:class{},Notification:class{static isSupported(){return false}},shell:{}};return orig.call(this,r,...a)};
const createVault=require('../dynamic-island/vault.js'),createAI=require('../dynamic-island/ai.js'),createMail=require('../dynamic-island/mail.js');
const fake={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('DPAPI:'+s),decryptString:b=>b.toString().slice(6)};
let f=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)f++};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'it-'));const vault=createVault({dir,safeStorage:fake});
 const db={settings:{aiProvider:'claude'}};const ai=createAI({getDb:()=>db,vault});
 ok(ai.status().canStore&&!ai.status().locked&&!ai.hasKey('claude'),'ai status: can store, no key yet');
 vault.set('claude','sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx');ok(ai.hasKey('claude')&&ai.status().claude,'ai sees key from vault');
 ok(!('key' in ai.status())&&!JSON.stringify(ai.status()).includes('sk-ant'),'status never leaks the key');
 await vault.setPassphrase('Tr0ub4dor&3-horse');vault.lock();
 ok(ai.status().locked&&!ai.hasKey('claude'),'locked vault: AI reports locked');
 const r=await ai.connect('openai','sk-proj-aaaaaaaaaaaaaaaaaaaaaaaa');ok(!r.ok&&/locked/.test(r.text),'connect refused while locked');
 const c=await ai.chat([{role:'user',content:'hi'}]);ok(!c.ok&&/locked/.test(c.text),'chat explains the lock');
 const m=createMail({getDb:()=>db,getWins:()=>[],goToMessages(){},vault});
 const g=await m.setGmail('a@gmail.com','abcdabcdabcdabcd');ok(!g.ok&&/locked/.test(g.text),'gmail refused while locked');
 console.log(f?f+' FAILED':'INTEGRATION OK');process.exit(f?1:0)})();
