import { JSDOM } from '../_repo/node_modules/jsdom/lib/api.js';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./guided-demo.html', import.meta.url).pathname,'utf8');
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'http://localhost/' });
const { window } = dom;
const d = window.document;
const q = (s) => d.querySelector(s);
const qa = (s) => [...d.querySelectorAll(s)];
let fail = 0;
const ok = (c,m) => { console.log(`  ${c?'✓':'✗'} ${m}`); if(!c) fail++; };

await new Promise(r => window.addEventListener('load', r));
await new Promise(r => setTimeout(r, 60));

console.log('══ boot state ══');
ok(qa('.pane.on').length===1, 'exactly one pane visible at start');
ok(q('#step-tag').textContent==='01', 'starts on step 01');
ok(q('#v-aud').textContent==='1', 'audit trail seeded with DEMO_START entry');
ok(qa('#audit-rows .arow').length===1, 'one audit row rendered');

console.log('\n══ navigate to attendance (step 3) ══');
q('#next').click(); await new Promise(r=>setTimeout(r,20));
q('#next').click(); await new Promise(r=>setTimeout(r,20));
ok(q('#step-tag').textContent==='03', 'now on step 03');
const checkBtns = qa('[data-check]');
ok(checkBtns.length===10, `check-in buttons rendered (${checkBtns.length} eligible of 12 members)`);
ok(q('#attend-list').textContent.includes('In arrears')||q('#attend-list').textContent.includes('Tunggakan'), 'arrears member shown as barred');

// check in the 5 eligible members
for (const b of qa('[data-check]')) { b.click(); await new Promise(r=>setTimeout(r,5)); }
await new Promise(r=>setTimeout(r,30));
const quorum = q('#v-quorum').textContent;
const att = q('#v-att').textContent;
ok(quorum.startsWith('10'), `quorum counter moved: ${quorum}`);
ok(att.startsWith('83'), `attendance % computed: ${att}`);
ok(qa('#audit-rows .arow').length===11, `audit grew to 11 rows (1 + 10 check-ins): ${qa('#audit-rows .arow').length}`);

console.log('\n══ voting (step 4) ══');
q('#next').click(); await new Promise(r=>setTimeout(r,30));
const voteBtns = qa('[data-vote]');
ok(voteBtns.length===6, `6 vote buttons (3 resolutions × 2) — got ${voteBtns.length}`);
// vote 12 times on resolution 1 to force a decision
ok(qa('[data-close]').length===0, 'no close button before any vote is cast');
for (let i=0;i<9;i++){ const b = qa('[data-vote="0"][data-yes="1"]')[0]; if(b){ b.click(); await new Promise(r=>setTimeout(r,3)); } }
await new Promise(r=>setTimeout(r,20));
ok(qa('[data-close]').length>0, 'close-poll control appears once votes exist');
qa('[data-close="0"]')[0].click(); await new Promise(r=>setTimeout(r,30));
const res1 = q('#resolutions').textContent;
ok(/CARRIED|LULUS/.test(res1), 'resolution 1 carried after closing the poll');
ok(q('#v-res').textContent.startsWith('1'), `passed counter: ${q('#v-res').textContent}`);

console.log('\n══ minutes derive from actions (step 5) ══');
q('#next').click(); await new Promise(r=>setTimeout(r,30));
const docQ = q('#doc-quorum').textContent;
const docR = q('#doc-res').textContent;
ok(/dipenuhi|satisfied/i.test(docQ) && !/belum|not yet/i.test(docQ), `minutes quorum line states met: "${docQ}"`);
ok(/CARRIED|LULUS/.test(docR), 'minutes resolution list shows the carried resolution');
ok(/head|kepala/.test(q('#doc-audit').textContent) && /[0-9a-f]{8}/.test(q('#doc-audit').textContent), `minutes carry an audit reference: "${q('#doc-audit').textContent.trim()}"`);

console.log('\n══ audit chain (step 6) ══');
q('#next').click(); await new Promise(r=>setTimeout(r,30));
const rows = qa('#audit-rows .arow');
ok(rows.length>=11, `audit rows in final view: ${rows.length}`);
const hashes = rows.map(r=>r.querySelector('.h').textContent.trim()).filter(Boolean);
ok(hashes.every(h=>/^[0-9a-f]{8}$/.test(h)), 'every row shows an 8-hex hash');
ok(new Set(hashes).size===hashes.length || hashes.length<2, 'hashes are distinct (chain advances, no repeats)');

console.log('\n══ reset ══');
q('#reset').click(); await new Promise(r=>setTimeout(r,30));
ok(q('#step-tag').textContent==='01', 'reset returns to step 01');
ok(qa('#audit-rows .arow').length===1, 'audit cleared back to a single DEMO_START');
ok(q('#v-quorum').textContent.startsWith('0'), `quorum back to zero: ${q('#v-quorum').textContent}`);

console.log('\n══ language switch ══');
q('#btn-en').click(); await new Promise(r=>setTimeout(r,60));
ok(q('#step-h').textContent==='Dashboard', `EN heading: "${q('#step-h').textContent}"`);
ok(d.documentElement.lang==='en', 'html lang switched to en');
q('#btn-ms').click(); await new Promise(r=>setTimeout(r,60));
ok(q('#step-h').textContent==='Papan pemuka', `BM heading restored: "${q('#step-h').textContent}"`);

console.log(`\n${fail===0?'✓ all demo interactions passed':`✗ ${fail} failure(s)`}`);
process.exit(fail?1:0);
