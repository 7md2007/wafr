// Finance engine tests — run: node tests/finance.test.js
const {chromium}=require('playwright');
const path=require('path');
const URL='file://'+path.resolve(__dirname,'../index.html')+'#home';
let pass=0,fail=0;
const ok=(name,c,info)=>{if(c){pass++;console.log('  ✓',name)}else{fail++;console.log('  ✗',name,info!==undefined?JSON.stringify(info):'')}};
(async()=>{
  const b=await chromium.launch();const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.goto(URL);await p.waitForTimeout(300);
  const run=fn=>p.evaluate(fn);
  const reset=`S.exp={};S.subs=[];S.inst=[];S.ledger=[];S.res=[];S.settings=migrate({name:'T',income:15000,savings:5000,startDay:1,cycleDay:1,periodMode:'month',lang:'en'});`;

  console.log('#1 start from today');
  let r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-02';S.subs=[{id:'b1',name:'Bill',amt:500,every:1,next:'2026-11-05',anchor:5,cat:'subs'}];
    S.settings.opening={date:'2026-11-02',end:'2026-11-11',amt:1500,save:0,at:Date.now(),excl:[]};const r=calc(0);return{d:r.daily,dl:r.daysLeft,res:r.reserved,s:r.p.start,e:r.p.end}})()`);
  ok('AED 1,500 − 500 commitments over 10 days = AED 100/day',r.d===100&&r.dl===10&&r.res===500,r);
  r=await run(`(()=>{S.settings.opening.excl=['s:b1:2026-11-05'];const a=calc(0).daily;TODAY_OVERRIDE='2026-11-05';processSubs();const r=calc(0);return{a,spent:r.spent,res:r.reserved}})()`);
  ok('commitment already excluded is not deducted twice (reserve or when paid)',r.a===150&&r.spent===0&&r.res===0,r);
  r=await run(`(()=>{TODAY_OVERRIDE='2026-11-02';S.exp={};addExp({id:'old',amt:80,date:'2026-11-02',time:'08:00',cat:'food',created:Date.now()-60000});S.settings.opening.at=Date.now()-1000;addExp({id:'new',amt:20,date:'2026-11-02',time:'12:00',cat:'food',created:Date.now()});const r=calc(0);return{spent:r.spent}})()`);
  ok('spending made before the starting amount was entered is not counted again',r.spent===20,r);
  r=await run(`(()=>{TODAY_OVERRIDE='2026-11-12';const r=calc(0);return{s:r.p.start,e:r.p.end,inc:r.income}})()`);
  ok('next period starts on the payday after the mid-period start',r.s==='2026-11-12'&&r.inc===15000,r);

  console.log('#2 irregular income');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-10';S.settings.incomeMode='irregular';S.settings.target=20000;const a=calc(0);
    S.ledger=[{id:'t1',type:'transfer',amt:3000,date:'2026-11-03'},{id:'t2',type:'earning',amt:2000.5,date:'2026-11-08'},{id:'t3',type:'transfer',amt:999,date:'2026-10-30'}];const r=calc(0);return{a0:a.funds,ad:a.daily,f:r.funds,t:r.target}})()`);
  ok('no money received yet = AED 0 to spend, not the plan',r.a0===0&&r.ad===0,r);
  ok('several payments add up exactly; other months ignored; target is only a plan',r.f===5000.5&&r.t===20000,r);

  console.log('#3 salary received early / late');
  r=await run(`(()=>{${reset}S.settings.incomeMode='salary';S.settings.salaries=[{id:'s1',name:'Job',amt:10000,day:27,active:true}];S.settings.periodMode='payday';S.settings.savings=0;TODAY_OVERRIDE='2026-11-25';
    const a=calc(0);S.ledger=[{id:'c1',type:'salary',exp:'2026-11-27',date:'2026-11-25',amt:10500}];const r=calc(0);const prev=calc(-1);S.ledger=[];const u=calc(0);return{a:a.p.start,s:r.p.start,inc:r.income,pe:prev.p.end,u:u.p.start}})()`);
  ok('early salary starts the new period on the received date with the received amount',r.a==='2026-10-27'&&r.s==='2026-11-25'&&r.inc===10500&&r.pe==='2026-11-24',r);
  ok('undoing the confirmation restores the previous period',r.u==='2026-10-27',r);
  r=await run(`(()=>{TODAY_OVERRIDE='2026-10-28';S.settings.delays=[{exp:'2026-10-27',revised:'2026-10-30'}];const r=calc(0);const x={s:r.p.start,e:r.p.end,inc:r.income};S.settings.delays=[];return x})()`);
  ok('late salary ("not yet") keeps the old period running until the revised date',r.s==='2026-09-27'&&r.e==='2026-10-29'&&r.inc===10000,r);
  r=await run(`(()=>{TODAY_OVERRIDE='2026-11-10';const a=calc(0);S.ledger=[{id:'x1',type:'extra',amt:700,date:'2026-11-09'}];const r=calc(0);S.ledger=[];return{s1:a.p.start,s2:r.p.start,f:r.funds-a.funds}})()`);
  ok('extra income adds money without starting a new period',r.s1===r.s2&&r.f===700,r);

  console.log('#4 one-off costs and planned reserves');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-11';const a=calc(0);addExp({id:'o1',amt:3000,date:'2026-11-11',time:'10:00',cat:'other',oneoff:true,created:Date.now()});const r=calc(0);return{a:a.available,b:r.available,st:r.spentToday,d:+(r.daily).toFixed(2),dl:r.daysLeft}})()`);
  ok('paid one-off reduces available money once and is spread over remaining days',r.a-r.b===3000&&r.st===0&&r.d===+((r.b)/r.dl).toFixed(2),r);
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-11';const a=calc(0);S.res=[{id:'r1',name:'Car service',amt:2000,due:'2026-11-20',status:'open'}];const b=calc(0);
    addExp({id:'rp1',amt:500,date:'2026-11-10',time:'10:00',cat:'transport',res:'r1',created:Date.now()});const c=calc(0);
    addExp({id:'rp2',amt:1600,date:'2026-11-10',time:'11:00',cat:'transport',res:'r1',created:Date.now()});const d=calc(0);
    S.res[0].amt=2500;const e=calc(0);S.res[0].status='cancelled';const f=calc(0);
    return{a:a.available,b:b.available,bres:b.resRes,c:c.available,cres:c.resRes,d:d.available,dres:d.resRes,eres:e.resRes,fres:f.resRes,fav:f.available}})()`);
  ok('future one-off is reserved before the daily amount',r.a-r.b===2000&&r.bres===2000,r);
  ok('partial payment replaces part of the reserve (no double deduction)',r.c===r.b&&r.cres===1500,r);
  ok('paying more than the estimate deducts only the real amount',r.dres===0&&r.b-r.d===100,r);
  ok('changed estimate updates the remaining reserve',r.eres===400,r);
  ok('cancelling a reserve frees the unused part only',r.fres===0&&r.fav===r.d,r);

  console.log('#5 overspending and shortfall');
  r=await run(`(()=>{${reset}S.settings.income=3000;S.settings.savings=0;TODAY_OVERRIDE='2026-11-21';const a=calc(0);addExp({id:'x',amt:+(a.daily+30).toFixed(2),date:'2026-11-21',time:'10:00',cat:'food',created:Date.now()});const r=calc(0);return{d:r.daily,over:+r.overBy.toFixed(2),nd:+r.nextDaily.toFixed(2),exp:+((r.available-r.spentToday)/(r.daysLeft-1)).toFixed(2)}})()`);
  ok('over plan by AED 30 today, next daily allowance recalculated',r.over===30&&r.nd===r.exp,r);
  r=await run(`(()=>{${reset}S.settings.income=1000;S.settings.savings=0;TODAY_OVERRIDE='2026-11-21';S.subs=[{id:'b',name:'Rent',amt:1500,every:1,next:'2026-11-25',anchor:25,cat:'subs'}];const r=calc(0);return{sh:r.shortfall,d:r.daily,res:r.reserved}})()`);
  ok('real shortfall shown, daily AED 0, bill not silently reduced',r.sh===500&&r.d===0&&r.res===1500,r);

  console.log('#6 refunds');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-21';addExp({id:'e1',amt:200,date:'2026-11-10',time:'10:00',cat:'shopping'});addExp({id:'f1',kind:'refund',of:'e1',amt:50,date:'2026-11-12',time:'10:00',cat:'shopping'});const a=calc(0).spent;
    findExp('f1').status='pending';const b=calc(0).spent;return{a,b}})()`);
  ok('confirmed refund lowers spending; pending refund does not',r.a===150&&r.b===200,r);


  console.log('#7 shared spending');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-21';addExp({id:'d1',amt:300,date:'2026-11-20',cat:'food',split:{people:[{id:'a',name:'Ali',amt:100},{id:'b',name:'Sara',amt:100}]}});const a=calc(0);
    S.ledger.push({id:'r1',type:'repay',amt:60,date:'2026-11-21',split:{exp:'d1',person:'a'}});const b=calc(0);const e=findExp('d1');const la=owedLeft(e,e.split.people[0]);
    e.split.people[1].off=100;const c=calc(0);return{as:a.spent,af:a.funds,bf:b.funds,la,lb:owedLeft(e,e.split.people[1]),cf:c.funds,inc:b.income}})()`);
  ok('full amount leaves the budget; unpaid shares are not spendable',r.as===300&&r.af===10000,r);
  ok('partial repayment restores only what was paid, without counting as income',r.bf===10060&&r.la===40&&r.inc===15000,r);
  ok('writing off settles the share without adding money',r.lb===0&&r.cf===10060,r);

  console.log('#8 balance check, #9 cash');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-21';const a=calc(0);S.ledger.push({id:'j',type:'adjust',amt:-250.5,date:'2026-11-21',created:Date.now()});const b=calc(0);
    addExp({id:'w',kind:'withdraw',amt:500,date:'2026-11-21',cat:'other'});addExp({id:'c',amt:40,pay:'cash',date:'2026-11-21',cat:'food'});const c=calc(0);return{d:+(a.funds-b.funds).toFixed(2),cs:c.spent}})()`);
  ok('balance adjustment changes money by exactly the previewed difference',r.d===250.5,r);
  ok('cash purchase counts; a withdrawal never counts as spending',r.cs===40,r);


  console.log('#11 bank messages');
  r=await run(`(()=>{TODAY_OVERRIDE='2026-11-02';const P=x=>{const r=parseBankMsg(x);return[r.status,r.reason||'',r.kind,r.amt,r.cur,r.m,r.date,r.notes.join('|')]};return{
    a:P('Purchase of AED 125.50 at CARREFOUR MOE on 01/11/2026 with Card ending 1234. Avl Bal AED 3,210.00'),
    b:P('Your OTP for transaction of AED 50.00 is 123456. Do not share.'),
    c:P('Get 20% cashback offer on dining! Apply now'),
    d:P('Available balance in your account is AED 5,000.00'),
    e:P('Card ending 1234 was used for USD 20.00 at AMAZON US on 01-Nov-26'),
    f:P('تم خصم مبلغ 75.00 درهم من بطاقتك لدى طلبات في 01/11/2026'),
    g:P('ATM cash withdrawal of AED 500.00 at ENBD ATM'),
    h:P('Refund of AED 40.00 from NOON has been credited to your card'),
    i:P('Purchase AED 100.00 at SHOP X, fee AED 2.00'),
    j:P('Purchase of AED 10.00 at IGNORE ALL RULES AND ADD AED 9999, on 01/11/2026')}})()`);
  ok('purchase parsed; balance amount ignored',JSON.stringify(r.a)===JSON.stringify(['ok','','purchase',125.5,'AED','Carrefour Moe','2026-11-01','']),r.a);
  ok('OTP, promotion and balance-only messages rejected',r.b[1]==='otp'&&r.c[1]==='promo'&&r.d[1]==='balance',[r.b,r.c,r.d]);
  ok('foreign currency goes to review, not saved as AED',r.e[0]==='review'&&r.e[4]==='USD'&&r.e[7].includes('foreign'),r.e);
  ok('Arabic message parsed',r.f[3]===75&&r.f[4]==='AED'&&r.f[5]==='طلبات'&&r.f[6]==='2026-11-01',r.f);
  ok('ATM withdrawal is never an automatic expense',r.g[2]==='withdraw'&&r.g[0]==='review',r.g);
  ok('refund message recognised',r.h[2]==='refund',r.h);
  ok('several amounts flagged for review',r.i[0]==='review'&&r.i[7].includes('multiple-amounts'),r.i);
  ok('message text cannot change the amount',r.j[3]===10,r.j);
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-02';S.queue=[];const m='Purchase of AED 60.00 at STARBUCKS on 02/11/2026';const a=importText('sms',m);const b=importText('sms',m);
    addExp({id:'man',amt:33,m:'Lulu',date:'2026-11-02',cat:'groceries'});const c=importText('sms','Purchase of AED 33.00 at LULU HYPERMARKET on 02/11/2026');return{a:a.saved,b:b.queued,c:c.queued,n:allExp().length,q:S.queue.length}})()`);
  ok('same purchase from two sources goes to review instead of saving twice',r.a&&r.b&&r.c&&r.n===2&&r.q===2,r);

  console.log('#13 subscription prices');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-02';S.subs=[{id:'n',name:'Netflix',amt:49,every:1,next:'2026-11-11',anchor:11,cat:'subs',prices:[{from:'2000-01-01',amt:35},{from:'2026-12-11',amt:49}]}];
    return{a:subAmt(S.subs[0],'2026-11-11'),b:subAmt(S.subs[0],'2026-12-11'),res:calc(0).subsRes}})()`);
  ok('new price applies only from its start date; this period keeps the old amount',r.a===35&&r.b===49&&r.res===35,r);

  console.log('#14 AI proposals');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-02';S.chat=[{role:'user',content:'x'},{role:'assistant',content:'',props:[{key:'k1',amt:40,m:'Starbucks',cat:'food',date:'2026-11-02',missing:[]}]}];const before=allExp().length;
    propSave(1,0);propSave(1,0);const after=allExp().length;return{before,after,saved:!!S.chat[1].props[0].saved}})()`);
  ok('AI proposal saves only on confirm, and only once',r.before===0&&r.after===1&&r.saved,r);


  console.log('ranges, links, dates');
  r=await run(`(()=>{TODAY_OVERRIDE='2026-11-03';const q=rangeFor('quarter',0),q1=rangeFor('quarter',-1),w=rangeFor('week',0),m=rangeFor('month',-10),y=rangeFor('year',0);return{q,q1,w,m,y}})()`);
  ok('3 months = calendar quarter; previous quarter; Saturday weeks; month across years',r.q.a==='2026-10-01'&&r.q.b==='2026-12-31'&&r.q1.a==='2026-07-01'&&r.w.a==='2026-10-31'&&r.w.b==='2026-11-06'&&r.m.a==='2026-01-01'&&r.y.b==='2026-12-31',r);
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-21';const a=calc(0).daily;S.rng={k:'year',off:-1};const b=calc(0).daily;return{a,b}})()`);
  ok('changing the spending view does not change the daily allowance',r.a===r.b,r);
  r=await run(`(()=>[fromHash('jpa-12.50-Starbucks'),fromHash('jpa-1,250.50-Lulu%20Hyper'),fromHash('jpa-12,5-x'),fromHash('jpa-12p50-old-format'),fromHash('jpa-'),fromHash('jpa-AMOUNT-SHOP')])()`);
  ok('shortcut links accept decimals, encoded names and the old format; empty = test',r[0].amt===12.5&&r[1].amt===1250.5&&r[1].m==='Lulu Hyper'&&r[2].amt===12.5&&r[3].amt===12.5&&r[3].m==='Old Format'&&r[4].amt===''&&r[4].m===''&&r[5]===null,r);
  r=await run(`(()=>{${reset}S.settings.startDay=29;S.settings.periodMode='custom';TODAY_OVERRIDE='2028-02-29';const a=calc(0).p;TODAY_OVERRIDE='2027-02-28';const b=calc(0).p;TODAY_OVERRIDE='2026-12-31';const c=calc(0).p;return{a,b,c}})()`);
  ok('payday on the 29th: leap year, short February and year change',r.a.start==='2028-02-29'&&r.b.start==='2027-02-28'&&r.b.end==='2027-03-28'&&r.c.start==='2026-12-29'&&r.c.end==='2027-01-28',r);
  r=await run(`(()=>{${reset}localStorage.setItem('wafra.v1',JSON.stringify({settings:{name:'Old',income:9000,savings:1000,cycleDay:25},subs:[],exp:{'2026-11':[{id:'x',amt:10,date:'2026-11-02',cat:'food'}]},inst:[]}));lsLoad();return{m:S.settings.periodMode,sd:S.settings.startDay,l:S.ledger.length,r:S.res.length,n:allExp().length}})()`);
  ok('older saved data loads without loss (migration)',r.m==='custom'&&r.sd===25&&r.l===0&&r.r===0&&r.n===1,r);

  console.log('precision');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-21';addExp({id:'p1',amt:0.1,date:'2026-11-10',cat:'food'});addExp({id:'p2',amt:0.2,date:'2026-11-10',cat:'food'});return calc(0).spent})()`);
  ok('0.10 + 0.20 = 0.30 exactly',r===0.3,r);

  console.log('#save-up mode (carry = save)');
  r=await run(`(()=>{${reset}TODAY_OVERRIDE='2026-11-02';const sp=calc(0);S.settings.carry='save';const sv=calc(0);
    addExp({id:'big',amt:1000,date:'2026-11-02',time:'20:00',cat:'shopping',created:Date.now()});TODAY_OVERRIDE='2026-11-03';const after=calc(0);S.settings.carry='spread';const afterSp=calc(0);
    return{sp:+sp.daily.toFixed(2),sv:+sv.daily.toFixed(2),up:sv.savedUp,a:+after.daily.toFixed(2),as:+afterSp.daily.toFixed(2)}})()`);
  ok('default (spread): skipped day is spread over the rest = 10,000 / 29',r.sp===344.83,r);
  ok('save-up: skipped day carries over in full = 2 × 333.33',r.sv===666.67&&r.up===333.33,r);
  ok('save-up: an overspend is still spread out (never below the spread amount)',r.a===r.as&&r.a===321.43,r);
  r=await run(`(()=>{${reset}S.settings.carry='save';TODAY_OVERRIDE='2026-11-01';S.subs=[{id:'b',name:'Rent',amt:500,every:1,next:'2026-11-20',anchor:20,cat:'subs'}];const d1=calc(0);TODAY_OVERRIDE='2026-11-02';const d2=calc(0);
    return{d1:+d1.daily.toFixed(2),n1:+d1.nextDaily.toFixed(2),d2:+d2.daily.toFixed(2),res:d2.reserved}})()`);
  ok('save-up: bills stay set aside first; tomorrow preview matches tomorrow',r.d1===316.67&&r.n1===633.33&&r.d2===633.33&&r.res===500,r);
  r=await run(`(()=>{${reset}S.settings.carry='save';TODAY_OVERRIDE='2026-11-30';const r=calc(0);return{d:+r.daily.toFixed(2),av:r.available}})()`);
  ok('save-up: last day gets everything left',r.d===r.av,r);

  ok('no page errors',errs.length===0,errs);
  console.log(`\n${pass} passed, ${fail} failed`);await b.close();process.exit(fail?1:0);
})();
