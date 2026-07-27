import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, getTxns, insertTxn, deleteTxn,
         getSettings, upsertSettings,
         getBankImports, insertBankImports, deleteBankImport, getAllBankImports,
         subscribeToMonth } from './supabase.js';
import { categorize, computeAverages } from './categorize.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

const CATS = [
  { id:'groceries',     label:'Groceries',       icon:'🛒', target:400,  color:'#16a34a' },
  { id:'restaurant',    label:'Eating out',      icon:'🍽️', target:250,  color:'#2563eb' },
  { id:'alcohol',       label:'Alcohol',         icon:'🍺', target:80,   color:'#ea580c' },
  { id:'uber',          label:'Uber',            icon:'🚗', target:80,   color:'#ca8a04' },
  { id:'transit',       label:'Transit',         icon:'🚇', target:30,   color:'#7c3aed' },
  { id:'pharmacy',      label:'Pharmacy',        icon:'💊', target:100,  color:'#db2777' },
  { id:'medical',       label:'Medical',         icon:'🏥', target:550,  color:'#dc2626' },
  { id:'entertainment', label:'Entertainment',   icon:'🎭', target:50,   color:'#059669' },
  { id:'hobbies',       label:'Hobbies & dev',   icon:'💻', target:150,  color:'#6366f1' },
  { id:'subscriptions', label:'Subscriptions',   icon:'📱', target:155,  color:'#0891b2' },
  { id:'other',         label:'Other',           icon:'📦', target:200,  color:'#6b7280' },
];

const FIXED = [
  { label:'Rent (STELA)',           amount:1900,  due:'Last day'     },
  { label:'Electricity (Metergy)',  amount:150,   due:'~15th'        },
  { label:'TD Insurance',           amount:66.50, due:'End of month' },
  { label:'Freedom Mobile',         amount:45.20, due:'~20th'        },
  { label:'Affirm Canada',          amount:51.51, due:'~23rd'        },
  { label:'BMO Plan Fee',           amount:17.95, due:'Last day'     },
];

const SUBS = [
  { label:'Claude.ai',       amount:31.64, due:'~30th'  },
  { label:'Apple (iCloud+)', amount:29.70, due:'~15th'  },
  { label:'YouTube Premium', amount:25.98, due:'~22nd'  },
  { label:'Dropbox',         amount:18.07, due:'~23rd'  },
  { label:'Amazon Prime',    amount:11.29, due:'~19th'  },
  { label:'Netflix',         amount:9.03,  due:'~2nd'   },
  { label:'Google One',      amount:7.90,  due:'~29th'  },
  { label:'Uber One',        amount:6.77,  due:'~6th'   },
  { label:'Anthropic API',   amount:12.00, due:'varies' },
  { label:'Prime Video',     amount:3.38,  due:'~29th'  },
];

const UPCOMING = [
  { label:'Rent',                amount:1900,  date:'Jul 31', crit:true,  type:'bill'    },
  { label:'Centre for Mindbody', amount:275,   date:'Jul 21', crit:false, type:'medical' },
  { label:'YouTube Premium',     amount:25.98, date:'Jul 22', crit:false, type:'sub'     },
  { label:'Affirm Canada',       amount:51.51, date:'Jul 23', crit:false, type:'bill'    },
  { label:'Claude.ai',           amount:31.64, date:'Jul 30', crit:false, type:'sub'     },
  { label:'TD Insurance',        amount:66.50, date:'Jul 31', crit:false, type:'bill'    },
  { label:'BMO Plan Fee',        amount:17.95, date:'Jul 31', crit:false, type:'bill'    },
  { label:'CTFS finance charge', amount:438,   date:'Aug 10', crit:true,  type:'debt'    },
  { label:'Netflix',             amount:9.03,  date:'Aug 2',  crit:false, type:'sub'     },
  { label:'Freedom Mobile',      amount:45.20, date:'Aug 20', crit:false, type:'bill'    },
];

const SOURCES = [
  { id:'BMO',      label:'BMO Chequing' },
  { id:'CTFS',     label:'Canadian Tire (CTFS)' },
  { id:'WS_JOINT', label:'Wealthsimple Joint' },
  { id:'PC_MC',    label:'PC Mastercard' },
];

const USERS = {
  jordan: { key:'jordan', name:'Jordan', initials:'JY',  color:'#2563eb', bg:'#eff6ff' },
  ness:   { key:'ness',   name:'Ness',   initials:'NMK', color:'#e11d48', bg:'#fff1f2' },
};

const DEF_INCOME = { jordan:3984.44, ness:800, sunlife:0 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt   = n => '$' + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits:2, maximumFractionDigits:2 });
const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const today = () => new Date().toISOString().slice(0,10);

function getMonthYear(date) {
  const d = new Date(date + 'T00:00:00');
  return { month: d.getMonth(), year: d.getFullYear() };
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

function parseCSVRow(line) {
  const cols = []; let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

function parseStatementCSV(text, source) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let headerIdx = -1; let headers = [];

  // Find header row
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const cols = parseCSVRow(lines[i]).map(c => c.toLowerCase().replace(/[^a-z0-9_ ]/g,'').trim());
    const hasDate = cols.some(c => c.includes('date'));
    const hasAmt  = cols.some(c => c.includes('amount') || c.includes('cad') || c.includes('net_cash'));
    const hasDesc = cols.some(c => c.includes('desc') || c.includes('name'));
    if (hasDate && hasAmt) { headerIdx = i; headers = cols; break; }
  }
  if (headerIdx < 0) return [];

  const dateIdx = headers.findIndex(c => c.includes('transaction_date') || c.includes('transaction date') || c === 'date');
  const descIdx = headers.findIndex(c => c.includes('description') || c.includes('desc') || c.includes('name'));
  const amtIdx  = headers.findIndex(c => c === 'cad$' || c === 'amount' || c === 'net_cash_amount' || c.includes('amount'));

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = parseCSVRow(lines[i]);
    if (cols.length < 3) continue;
    const date = cols[dateIdx]?.replace(/['"]/g,'').trim();
    const desc = cols[descIdx]?.replace(/['"]/g,'').trim();
    const raw  = cols[amtIdx]?.replace(/['"$, ]/g,'').trim();
    if (!date || !desc || !raw || isNaN(parseFloat(raw))) continue;

    const amount = Math.abs(parseFloat(raw));
    if (amount < 0.50) continue; // skip tiny amounts

    const cat = categorize(desc);
    if (cat === '_skip') continue; // drop transfers/fees

    const { month, year } = getMonthYear(date);

    rows.push({
      id: uid(), date, description: desc, amount,
      category: cat, source, month, year,
    });
  }
  return rows;
}

// ─── UI Atoms ─────────────────────────────────────────────────────────────────

function Avatar({ who, size=28 }) {
  const u = USERS[who] || USERS.jordan;
  return <div style={{ width:size, height:size, borderRadius:'50%', background:u.color, color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center', fontSize:size*0.31,
    fontWeight:700, letterSpacing:'-0.02em', flexShrink:0 }}>{u.initials}</div>;
}

function Bar({ spent, target, color }) {
  const pct = Math.min((spent / Math.max(target,1))*100, 100);
  return <div style={{ height:5, background:'#f1f5f9', borderRadius:99, overflow:'hidden' }}>
    <div style={{ height:'100%', width:`${pct}%`, borderRadius:99,
      background: spent>target ? '#ef4444' : color, transition:'width 0.3s ease' }} />
  </div>;
}

function Card({ children, style={} }) {
  return <div style={{ background:'#fff', borderRadius:16, padding:16, marginBottom:12,
    boxShadow:'0 1px 3px rgba(0,0,0,0.06)', ...style }}>{children}</div>;
}

function SLabel({ children }) {
  return <p style={{ fontSize:11, fontWeight:700, color:'#94a3b8',
    textTransform:'uppercase', letterSpacing:'0.08em', margin:'0 0 8px' }}>{children}</p>;
}

function Toast({ msg }) {
  return <div style={{ position:'fixed', bottom:80, left:'50%', transform:'translateX(-50%)',
    background:'#111827', color:'#fff', padding:'10px 20px', borderRadius:99,
    fontSize:13, fontWeight:500, whiteSpace:'nowrap', zIndex:999,
    boxShadow:'0 4px 12px rgba(0,0,0,0.25)', pointerEvents:'none' }}>{msg}</div>;
}

function Spinner() {
  return <div style={{ width:18, height:18, border:'2px solid #e5e7eb',
    borderTopColor:'#16a34a', borderRadius:'50%', animation:'spin 0.7s linear infinite',
    display:'inline-block' }} />;
}

// ─── Setup Screen (first run if Supabase not configured) ──────────────────────

function SetupScreen() {
  return (
    <div style={{ minHeight:'100dvh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', padding:32, background:'#f8fafc' }}>
      <div style={{ fontSize:52, marginBottom:8 }}>⚙️</div>
      <h1 style={{ fontSize:22, fontWeight:800, margin:'0 0 8px', color:'#0f172a' }}>
        Supabase not connected
      </h1>
      <p style={{ fontSize:14, color:'#64748b', margin:'0 0 24px', textAlign:'center', maxWidth:320 }}>
        Add your Supabase credentials as environment variables in Netlify, then redeploy.
        See the DEPLOY.md file for step-by-step instructions.
      </p>
      <div style={{ background:'#1e293b', borderRadius:12, padding:'16px 20px',
        width:'100%', maxWidth:340, fontFamily:'monospace', fontSize:12, color:'#94a3b8' }}>
        <p style={{ color:'#4ade80', margin:'0 0 4px' }}># Netlify → Site settings → Env vars</p>
        <p style={{ margin:0 }}>VITE_SUPABASE_URL = https://xxx.supabase.co</p>
        <p style={{ margin:0 }}>VITE_SUPABASE_ANON_KEY = eyJh...</p>
      </div>
    </div>
  );
}

// ─── User Picker ──────────────────────────────────────────────────────────────

function UserPicker({ onPick }) {
  return (
    <div style={{ minHeight:'100dvh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', padding:32, background:'#f8fafc' }}>
      <div style={{ fontSize:52, marginBottom:6 }}>🏠</div>
      <h1 style={{ fontSize:26, fontWeight:800, margin:'0 0 6px', color:'#0f172a', letterSpacing:'-0.03em' }}>
        Home budget
      </h1>
      <p style={{ fontSize:15, color:'#64748b', margin:'0 0 40px', textAlign:'center' }}>
        Jordan & Ness — live shared tracking
      </p>
      {Object.values(USERS).map(u => (
        <button key={u.key} onClick={() => onPick(u.key)} style={{
          border:`2px solid ${u.color}`, borderRadius:18, background:u.bg, cursor:'pointer',
          width:'100%', maxWidth:320, padding:'16px 20px', display:'flex', alignItems:'center',
          gap:14, marginBottom:12, textAlign:'left' }}>
          <Avatar who={u.key} size={46} />
          <div>
            <p style={{ margin:0, fontSize:17, fontWeight:700, color:'#0f172a' }}>I'm {u.name}</p>
            <p style={{ margin:0, fontSize:13, color:'#64748b' }}>Log expenses as {u.name}</p>
          </div>
        </button>
      ))}
      <p style={{ fontSize:11, color:'#94a3b8', marginTop:20, textAlign:'center' }}>
        Your choice is saved on this device.<br/>
        All data syncs live via Supabase.
      </p>
    </div>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────

function HomeTab({ txns, bankImports, income, ccTarget, setIncome, setCcTarget,
                   year, month, onSaveSettings, suggestedBudgets, onAcceptSuggested }) {
  const totalIncome   = Object.values(income).reduce((a,b)=>a+b,0);
  const totalFixed    = FIXED.reduce((a,b)=>a+b.amount,0);
  const totalSubs     = SUBS.reduce((a,b)=>a+b.amount,0);
  const committed     = totalFixed + totalSubs + ccTarget;
  const allTx         = [...txns, ...bankImports];
  const txByCat       = {};
  allTx.forEach(t => { if (t.category && t.category!=='_skip') txByCat[t.category]=(txByCat[t.category]||0)+t.amount; });
  const totalSpent    = Object.values(txByCat).reduce((a,b)=>a+b,0);
  const surplus       = totalIncome - committed - totalSpent;
  const jordanAdded   = txns.filter(t=>t.who==='jordan').reduce((a,t)=>a+t.amount,0);
  const nessAdded     = txns.filter(t=>t.who==='ness').reduce((a,t)=>a+t.amount,0);
  const hasSuggested  = Object.keys(suggestedBudgets||{}).length > 0;

  const BUDGET_TARGETS = Object.fromEntries(CATS.map(c=>[c.id,c.target]));

  return (
    <div style={{ padding:'14px 14px 0' }}>

      {/* Summary */}
      <Card>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
          {[['Income',fmt(totalIncome),'#16a34a'],
            ['Committed',fmt(committed),'#ea580c'],
            ['Surplus',(surplus>=0?'+':'–')+fmt(surplus),surplus>=0?'#16a34a':'#ef4444']
          ].map(([l,v,c])=>(
            <div key={l} style={{ textAlign:'center' }}>
              <p style={{ margin:'0 0 3px', fontSize:10, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em' }}>{l}</p>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:c, fontVariantNumeric:'tabular-nums' }}>{v}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* CTFS alert */}
      <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:12,
        padding:'10px 12px', marginBottom:12, display:'flex', gap:8, alignItems:'center' }}>
        <span style={{ fontSize:16, flexShrink:0 }}>⚠️</span>
        <div style={{ flex:1 }}>
          <p style={{ margin:'0 0 2px', fontSize:12, fontWeight:700, color:'#991b1b' }}>
            CTFS: $18,933 @ 22% APR · ~$438/mo interest
          </p>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:11, color:'#b91c1c' }}>Payment target: $</span>
            <input type="number" value={ccTarget}
              onChange={e => { setCcTarget(parseFloat(e.target.value)||0); onSaveSettings(); }}
              style={{ width:64, border:'1px solid #fca5a5', borderRadius:6, padding:'2px 6px',
                fontSize:12, fontWeight:700, color:'#991b1b', background:'#fff' }} />
          </div>
        </div>
      </div>

      {/* Budget insight if suggestions exist */}
      {hasSuggested && (
        <div style={{ background:'#f0fdf4', border:'1px solid #86efac', borderRadius:12,
          padding:'12px 14px', marginBottom:12 }}>
          <p style={{ margin:'0 0 6px', fontSize:13, fontWeight:700, color:'#166534' }}>
            💡 Budget suggestions from your statements
          </p>
          <p style={{ margin:'0 0 10px', fontSize:12, color:'#15803d' }}>
            Based on your imported bank data, here are updated targets that match your actual spending:
          </p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
            {Object.entries(suggestedBudgets).map(([cat,val])=>{
              const c = CATS.find(x=>x.id===cat);
              if (!c) return null;
              const cur = BUDGET_TARGETS[cat];
              return (
                <div key={cat} style={{ background:'#fff', borderRadius:8, padding:'4px 10px',
                  fontSize:11, fontWeight:600, color:'#166534', border:'1px solid #86efac' }}>
                  {c.icon} {c.label}: {cur!==val?<><s style={{color:'#94a3b8'}}>${cur}</s> → </>:''}<b>${val}</b>
                </div>
              );
            })}
          </div>
          <button onClick={onAcceptSuggested} style={{ border:'none', borderRadius:8, padding:'8px 16px',
            background:'#16a34a', color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            Apply all suggestions
          </button>
        </div>
      )}

      {/* Who added what */}
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        {Object.values(USERS).map(u=>(
          <div key={u.key} style={{ flex:1, background:u.bg, borderRadius:12, padding:'10px 14px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
              <Avatar who={u.key} size={20} />
              <span style={{ fontSize:12, fontWeight:600, color:u.color }}>{u.name} logged</span>
            </div>
            <p style={{ margin:0, fontSize:18, fontWeight:800, color:'#0f172a', fontVariantNumeric:'tabular-nums' }}>
              {fmt(u.key==='jordan'?jordanAdded:nessAdded)}
            </p>
          </div>
        ))}
      </div>

      {/* Category bars */}
      <SLabel>Spending this month (manual + imported)</SLabel>
      <Card style={{ padding:'10px 14px' }}>
        {CATS.map((cat,i)=>{
          const spent=txByCat[cat.id]||0; const over=spent>cat.target;
          return (
            <div key={cat.id} style={{ paddingBottom:i<CATS.length-1?10:0,
              marginBottom:i<CATS.length-1?10:0, borderBottom:i<CATS.length-1?'1px solid #f8fafc':'none' }}>
              <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:4 }}>
                <span style={{ fontSize:15 }}>{cat.icon}</span>
                <span style={{ flex:1, fontSize:12, color:'#374151' }}>{cat.label}</span>
                <span style={{ fontSize:12, fontWeight:700,
                  color:over?'#ef4444':spent>0?'#0f172a':'#cbd5e1',
                  fontVariantNumeric:'tabular-nums' }}>{fmt(spent)}</span>
                <span style={{ fontSize:10, color:'#94a3b8', marginLeft:2 }}>/ {fmt(cat.target)}</span>
              </div>
              <Bar spent={spent} target={cat.target} color={cat.color} />
              {over && <p style={{ margin:'3px 0 0', fontSize:10, color:'#ef4444' }}>Over by {fmt(spent-cat.target)}</p>}
            </div>
          );
        })}
      </Card>

      {/* Income editor */}
      <SLabel>Income this month</SLabel>
      <Card style={{ padding:'10px 14px' }}>
        {[['jordan','Jordan — NORR salary (est.)'],['ness','Ness — contribution'],['sunlife','SunLife reimbursement']].map(([k,l])=>(
          <div key={k} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            {k!=='sunlife'?<Avatar who={k} size={20}/>:<span style={{ fontSize:16, width:20, textAlign:'center' }}>💙</span>}
            <span style={{ flex:1, fontSize:12, color:'#374151' }}>{l}</span>
            <div style={{ display:'flex', alignItems:'center', gap:2 }}>
              <span style={{ fontSize:12, color:'#16a34a' }}>$</span>
              <input type="number" value={income[k]}
                onChange={e=>{ setIncome(prev=>({...prev,[k]:parseFloat(e.target.value)||0})); onSaveSettings(); }}
                style={{ width:84, border:'1px solid #e5e7eb', borderRadius:8, padding:'3px 6px',
                  fontSize:12, fontWeight:700, color:'#0f172a', textAlign:'right', background:'#f8fafc' }} />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── ADD TAB ──────────────────────────────────────────────────────────────────

function AddTab({ user, onAdd }) {
  const [cat, setCat]       = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote]     = useState('');
  const [date, setDate]     = useState(today());
  const [who, setWho]       = useState(user);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const can = cat && parseFloat(amount) > 0;

  async function submit() {
    if (!can || saving) return;
    setSaving(true);
    await onAdd({ cat, amount:parseFloat(amount), note:note.trim(), date, who });
    setCat(null); setAmount(''); setNote(''); setDate(today());
    setSaving(false); ref.current?.focus();
  }

  return (
    <div style={{ padding:'14px 14px 0' }}>
      <Card style={{ textAlign:'center', padding:'20px 14px' }}>
        <p style={{ margin:'0 0 4px', fontSize:10, color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.08em' }}>Amount</p>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:2 }}>
          <span style={{ fontSize:30, fontWeight:300, color:'#94a3b8' }}>$</span>
          <input ref={ref} type="number" inputMode="decimal" placeholder="0.00" value={amount}
            onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{ fontSize:52, fontWeight:800, color:'#0f172a', border:'none', outline:'none',
              background:'none', width:180, textAlign:'center', letterSpacing:'-0.03em',
              fontFamily:'Georgia, Times, serif', fontVariantNumeric:'tabular-nums' }} />
        </div>
      </Card>

      <SLabel>Category</SLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:7, marginBottom:12 }}>
        {CATS.map(c=>(
          <button key={c.id} onClick={()=>setCat(c.id)} style={{
            border:`2px solid ${cat===c.id?c.color:'#f1f5f9'}`, borderRadius:12,
            padding:'9px 3px', display:'flex', flexDirection:'column', alignItems:'center', gap:3,
            background:cat===c.id?c.color:'#fff', cursor:'pointer', transition:'all 0.12s' }}>
            <span style={{ fontSize:20 }}>{c.icon}</span>
            <span style={{ fontSize:9, fontWeight:700, color:cat===c.id?'#fff':'#64748b',
              textAlign:'center', lineHeight:1.2 }}>{c.label}</span>
          </button>
        ))}
      </div>

      <Card>
        <input type="text" placeholder="Note (optional)" value={note}
          onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
          style={{ width:'100%', border:'none', outline:'none', fontSize:15, color:'#0f172a',
            background:'none', marginBottom:12 }} />
        <div style={{ borderTop:'1px solid #f1f5f9', paddingTop:10, display:'flex', gap:10, alignItems:'flex-end' }}>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:10, color:'#94a3b8', display:'block', marginBottom:3 }}>Date</label>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 8px',
                fontSize:12, color:'#374151', background:'#f8fafc', width:'100%' }} />
          </div>
          <div>
            <label style={{ fontSize:10, color:'#94a3b8', display:'block', marginBottom:3 }}>Added by</label>
            <div style={{ display:'flex', gap:6 }}>
              {Object.values(USERS).map(u=>(
                <button key={u.key} onClick={()=>setWho(u.key)} style={{ border:`1px solid ${who===u.key?u.color:'#e5e7eb'}`,
                  borderRadius:8, padding:'5px 10px', fontSize:12, fontWeight:700, cursor:'pointer',
                  background:who===u.key?u.color:'#f8fafc', color:who===u.key?'#fff':'#64748b' }}>{u.name}</button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <button onClick={submit} disabled={!can||saving} style={{ border:'none', width:'100%', padding:'15px',
        borderRadius:14, fontSize:15, fontWeight:800, cursor:can?'pointer':'default',
        background:can?'#16a34a':'#e5e7eb', color:can?'#fff':'#94a3b8', marginBottom:10,
        display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
        {saving ? <><Spinner/> Saving…</> : can ? `Add ${CATS.find(c=>c.id===cat)?.icon||''} ${fmt(parseFloat(amount))}` : 'Choose a category and enter amount'}
      </button>
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────────────────────

function HistoryTab({ txns, bankImports, onDeleteTxn, onDeleteImport }) {
  const [filter, setFilter]   = useState('all');
  const [source, setSource]   = useState('all');

  const all = [
    ...txns.map(t=>({...t, _type:'manual'})),
    ...bankImports.map(t=>({...t, _type:'import', who:t.who||'jordan'})),
  ]
    .filter(t => filter==='all' || t.who===filter)
    .filter(t => source==='all' || (source==='manual'&&t._type==='manual') || (source==='import'&&t._type==='import'))
    .sort((a,b)=>new Date(b.date)-new Date(a.date));

  const grouped = {};
  all.forEach(t=>{
    const label = new Date(t.date+'T00:00:00').toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
    if (!grouped[label]) grouped[label]=[];
    grouped[label].push(t);
  });

  const total = all.reduce((a,t)=>a+t.amount,0);

  return (
    <div style={{ padding:'14px 14px 0' }}>
      <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
        {[['all','Everyone'],['jordan','Jordan'],['ness','Ness']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{ border:'none', padding:'5px 12px',
            borderRadius:99, fontSize:12, fontWeight:600, cursor:'pointer',
            background:filter===k?'#0f172a':'#f1f5f9', color:filter===k?'#fff':'#64748b' }}>{l}</button>
        ))}
        <div style={{ width:'100%' }} />
        {[['all','All entries'],['manual','Manual'],['import','Imported']].map(([k,l])=>(
          <button key={k} onClick={()=>setSource(k)} style={{ border:'none', padding:'4px 10px',
            borderRadius:99, fontSize:11, fontWeight:600, cursor:'pointer',
            background:source===k?'#6366f1':'#f1f5f9', color:source===k?'#fff':'#64748b' }}>{l}</button>
        ))}
      </div>

      {all.length > 0 && (
        <div style={{ textAlign:'right', marginBottom:8, fontSize:12, color:'#94a3b8' }}>
          {all.length} transactions · {fmt(total)}
        </div>
      )}

      {all.length===0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:'#94a3b8' }}>
          <div style={{ fontSize:40, marginBottom:8 }}>📋</div>
          <p style={{ fontSize:15 }}>No transactions yet</p>
        </div>
      ) : (
        Object.entries(grouped).map(([day,items])=>(
          <div key={day}>
            <p style={{ margin:'0 0 6px', fontSize:10, color:'#94a3b8', fontWeight:700,
              textTransform:'uppercase', letterSpacing:'0.06em' }}>{day}</p>
            <Card style={{ padding:'2px 0' }}>
              {items.map((tx,i)=>{
                const cat = CATS.find(c=>c.id===tx.cat||c.id===tx.category)||{icon:'📦',label:'Other'};
                const isImport = tx._type==='import';
                return (
                  <div key={tx.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 14px',
                    borderBottom:i<items.length-1?'1px solid #f8fafc':'none',
                    background:isImport?'#fafafa':'#fff' }}>
                    <span style={{ fontSize:20, flexShrink:0 }}>{cat.icon}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:13, fontWeight:600, color:'#0f172a',
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {tx.note||tx.description||cat.label}
                      </p>
                      <p style={{ margin:'1px 0 0', fontSize:10, color:'#94a3b8' }}>
                        {isImport ? `📥 ${tx.source}` : cat.label}
                      </p>
                    </div>
                    <Avatar who={tx.who||'jordan'} size={20} />
                    <span style={{ fontSize:14, fontWeight:800, color:'#0f172a',
                      fontVariantNumeric:'tabular-nums', minWidth:64, textAlign:'right' }}>{fmt(tx.amount)}</span>
                    <button onClick={()=>{ if(window.confirm('Remove?'))
                        isImport ? onDeleteImport(tx.id) : onDeleteTxn(tx.id); }}
                      style={{ border:'none', background:'none', color:'#d1d5db', fontSize:20,
                        lineHeight:1, padding:'0 0 0 4px', cursor:'pointer' }}>×</button>
                  </div>
                );
              })}
            </Card>
          </div>
        ))
      )}
    </div>
  );
}

// ─── BILLS TAB ────────────────────────────────────────────────────────────────

function BillsTab() {
  const tc={bill:'#2563eb',sub:'#7c3aed',medical:'#dc2626',debt:'#ef4444'};
  const tl={bill:'Bill',sub:'Sub',medical:'Medical',debt:'⚠ Debt'};
  return (
    <div style={{ padding:'14px 14px 0' }}>
      <SLabel>Upcoming — next 30 days</SLabel>
      <Card style={{ padding:'2px 0' }}>
        {UPCOMING.map((item,i)=>(
          <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px',
            background:item.crit?'#fef2f2':'transparent',
            borderBottom:i<UPCOMING.length-1?'1px solid #f8fafc':'none' }}>
            <div style={{ flex:1 }}>
              <p style={{ margin:0, fontSize:13, fontWeight:item.crit?700:500, color:item.crit?'#991b1b':'#0f172a' }}>{item.label}</p>
              <p style={{ margin:'2px 0 0', fontSize:11, color:item.crit?'#b91c1c':'#94a3b8' }}>{item.date}</p>
            </div>
            <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:99,
              background:(tc[item.type]||'#6b7280')+'18', color:tc[item.type]||'#6b7280' }}>{tl[item.type]||item.type}</span>
            <span style={{ fontSize:13, fontWeight:700, color:item.crit?'#991b1b':'#0f172a',
              fontVariantNumeric:'tabular-nums', minWidth:64, textAlign:'right' }}>{fmt(item.amount)}</span>
          </div>
        ))}
      </Card>
      <SLabel>Monthly fixed — {fmt(FIXED.reduce((a,b)=>a+b.amount,0))}/mo</SLabel>
      <Card style={{ padding:'2px 0' }}>
        {FIXED.map((f,i)=>(
          <div key={i} style={{ display:'flex', padding:'9px 14px', borderBottom:i<FIXED.length-1?'1px solid #f8fafc':'none' }}>
            <span style={{ flex:1, fontSize:13, color:'#374151' }}>{f.label}</span>
            <span style={{ fontSize:11, color:'#94a3b8', marginRight:10 }}>{f.due}</span>
            <span style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{fmt(f.amount)}</span>
          </div>
        ))}
      </Card>
      <SLabel>Subscriptions — {fmt(SUBS.reduce((a,b)=>a+b.amount,0))}/mo</SLabel>
      <Card style={{ padding:'2px 0' }}>
        {SUBS.map((s,i)=>(
          <div key={i} style={{ display:'flex', padding:'9px 14px', borderBottom:i<SUBS.length-1?'1px solid #f8fafc':'none' }}>
            <span style={{ flex:1, fontSize:13, color:'#374151' }}>{s.label}</span>
            <span style={{ fontSize:11, color:'#94a3b8', marginRight:10 }}>{s.due}</span>
            <span style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{fmt(s.amount)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── UPLOAD TAB ───────────────────────────────────────────────────────────────

function UploadTab({ showToast, onImported }) {
  const [step,       setStep]       = useState('pick');   // 'pick' | 'review' | 'done'
  const [source,     setSource]     = useState('BMO');
  const [who,        setWho]        = useState('jordan');
  const [parsed,     setParsed]     = useState([]);
  const [edits,      setEdits]      = useState({});
  const [saving,     setSaving]     = useState(false);
  const [stats,      setStats]      = useState(null);
  const fileRef = useRef(null);

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const rows = parseStatementCSV(ev.target.result, source);
      if (rows.length === 0) {
        showToast('No transactions found — check the file format');
        return;
      }
      // Apply who to all rows
      const withWho = rows.map(r => ({ ...r, who }));
      setParsed(withWho);
      setEdits({});
      setStep('review');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function toggleRow(id) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], skip: !prev[id]?.skip } }));
  }

  function changeCat(id, cat) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], cat } }));
  }

  async function confirmImport() {
    setSaving(true);
    const toImport = parsed
      .filter(r => !edits[r.id]?.skip)
      .map(r => ({ ...r, category: edits[r.id]?.cat || r.category }));

    try {
      await insertBankImports(toImport);
      const byMonth = {};
      toImport.forEach(r => {
        const k = `${MONTHS[r.month]} ${r.year}`;
        byMonth[k] = (byMonth[k]||0) + 1;
      });
      setStats({ count: toImport.length, byMonth });
      setStep('done');
      onImported();
      showToast(`Imported ${toImport.length} transactions`);
    } catch (err) {
      showToast('Import failed — ' + err.message);
    }
    setSaving(false);
  }

  function reset() {
    setStep('pick'); setParsed([]); setEdits({}); setStats(null);
  }

  // Summarise parsed rows
  const toImport    = parsed.filter(r=>!edits[r.id]?.skip);
  const skipped     = parsed.length - toImport.length;
  const byMonth     = {};
  parsed.forEach(r => {
    const k=`${MONTHS[r.month]} ${r.year}`;
    if (!byMonth[k]) byMonth[k]=[];
    byMonth[k].push(r);
  });

  const uncategorised = parsed.filter(r=> (edits[r.id]?.cat||r.category)==='other').length;

  // ── Pick screen ─────────────────────────────────────────────────────────────
  if (step==='pick') return (
    <div style={{ padding:'14px 14px 0' }}>
      <Card style={{ background:'#f0fdf4', border:'1px solid #86efac' }}>
        <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:700, color:'#166534' }}>📥 Upload a bank statement</p>
        <p style={{ margin:0, fontSize:12, color:'#15803d' }}>
          Upload any CSV from BMO, CTFS, WS, or PC MC. Transactions are auto-categorised
          using your spending history and added to this month's budget.
          Multiple months in one file are handled automatically.
        </p>
      </Card>

      <SLabel>Source account</SLabel>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
        {SOURCES.map(s=>(
          <button key={s.id} onClick={()=>setSource(s.id)} style={{ border:`2px solid ${source===s.id?'#2563eb':'#e5e7eb'}`,
            borderRadius:12, padding:'10px 12px', background:source===s.id?'#eff6ff':'#fff',
            cursor:'pointer', fontSize:13, fontWeight:600,
            color:source===s.id?'#2563eb':'#374151', textAlign:'left' }}>{s.label}</button>
        ))}
      </div>

      <SLabel>Spending belongs to</SLabel>
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {Object.values(USERS).map(u=>(
          <button key={u.key} onClick={()=>setWho(u.key)} style={{ flex:1, border:`2px solid ${who===u.key?u.color:'#e5e7eb'}`,
            borderRadius:12, padding:'10px', background:who===u.key?u.bg:'#fff', cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <Avatar who={u.key} size={22} />
            <span style={{ fontSize:13, fontWeight:600, color:who===u.key?u.color:'#374151' }}>{u.name}</span>
          </button>
        ))}
      </div>

      <input ref={fileRef} type="file" accept=".csv,.CSV" onChange={handleFile} style={{ display:'none' }} />
      <button onClick={()=>fileRef.current?.click()} style={{ border:'none', width:'100%', padding:'16px',
        borderRadius:14, fontSize:15, fontWeight:800, background:'#2563eb', color:'#fff', cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
        <span style={{ fontSize:20 }}>📂</span> Choose CSV file
      </button>
      <p style={{ textAlign:'center', fontSize:11, color:'#94a3b8', marginTop:10 }}>
        Supports BMO, CTFS, WS, and PC Mastercard CSV exports
      </p>
    </div>
  );

  // ── Review screen ────────────────────────────────────────────────────────────
  if (step==='review') return (
    <div style={{ padding:'14px 14px 0' }}>
      <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center' }}>
        <button onClick={reset} style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'5px 10px',
          background:'#fff', fontSize:13, color:'#374151', cursor:'pointer' }}>← Back</button>
        <div style={{ flex:1 }}>
          <p style={{ margin:0, fontSize:13, fontWeight:700, color:'#0f172a' }}>
            {parsed.length} transactions found
          </p>
          <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>
            {toImport.length} to import · {skipped} skipped
            {uncategorised>0 ? ` · ${uncategorised} uncategorised` : ''}
          </p>
        </div>
        <button onClick={confirmImport} disabled={saving||toImport.length===0}
          style={{ border:'none', borderRadius:10, padding:'8px 14px', cursor:'pointer',
            background:toImport.length>0?'#16a34a':'#e5e7eb', color:toImport.length>0?'#fff':'#94a3b8',
            fontSize:13, fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
          {saving?<><Spinner/>…</>:'Import'}
        </button>
      </div>

      {uncategorised > 0 && (
        <div style={{ background:'#fefce8', border:'1px solid #fde68a', borderRadius:10,
          padding:'10px 12px', marginBottom:12, fontSize:12, color:'#78350f' }}>
          ⚠️ {uncategorised} transactions landed in "Other" — tap their category pill to fix it.
        </div>
      )}

      {/* Group by month */}
      {Object.entries(byMonth).map(([mk, rows])=>(
        <div key={mk}>
          <p style={{ margin:'0 0 6px', fontSize:11, fontWeight:700, color:'#94a3b8',
            textTransform:'uppercase', letterSpacing:'0.06em' }}>{mk} · {rows.length} transactions</p>
          <Card style={{ padding:'2px 0', marginBottom:12 }}>
            {rows.map((tx,i)=>{
              const editedCat = edits[tx.id]?.cat || tx.category;
              const skp       = edits[tx.id]?.skip || false;
              const cat       = CATS.find(c=>c.id===editedCat)||{icon:'📦',color:'#6b7280'};
              return (
                <div key={tx.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
                  borderBottom:i<rows.length-1?'1px solid #f8fafc':'none',
                  opacity:skp?0.35:1, background:skp?'#f8fafc':'#fff' }}>
                  {/* Skip toggle */}
                  <button onClick={()=>toggleRow(tx.id)} style={{ border:'none', background:'none',
                    fontSize:16, cursor:'pointer', lineHeight:1, padding:0, flexShrink:0 }}>
                    {skp?'☑️':'✅'}
                  </button>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:11, color:'#374151', overflow:'hidden',
                      textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.description}</p>
                    <p style={{ margin:0, fontSize:10, color:'#94a3b8' }}>{tx.date}</p>
                  </div>
                  {/* Category selector */}
                  <select value={editedCat} onChange={e=>changeCat(tx.id,e.target.value)}
                    style={{ border:`1px solid ${cat.color}`, borderRadius:8, padding:'3px 6px',
                      fontSize:10, fontWeight:700, color:cat.color, background:'#fff',
                      cursor:'pointer', maxWidth:110 }}>
                    {CATS.map(c=><option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
                  </select>
                  <span style={{ fontSize:12, fontWeight:700, color:'#0f172a',
                    fontVariantNumeric:'tabular-nums', minWidth:56, textAlign:'right' }}>
                    {fmt(tx.amount)}
                  </span>
                </div>
              );
            })}
          </Card>
        </div>
      ))}

      <button onClick={confirmImport} disabled={saving||toImport.length===0}
        style={{ border:'none', width:'100%', padding:'15px', borderRadius:14, fontSize:15, fontWeight:800,
          background:toImport.length>0?'#16a34a':'#e5e7eb', color:toImport.length>0?'#fff':'#94a3b8',
          cursor:toImport.length>0?'pointer':'default', display:'flex', alignItems:'center',
          justifyContent:'center', gap:8, marginBottom:16 }}>
        {saving?<><Spinner/> Importing…</>:`Import ${toImport.length} transactions`}
      </button>
    </div>
  );

  // ── Done screen ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding:'14px 14px 0' }}>
      <Card style={{ background:'#f0fdf4', border:'1px solid #86efac', textAlign:'center', padding:'28px 20px' }}>
        <div style={{ fontSize:48, marginBottom:8 }}>✅</div>
        <h2 style={{ fontSize:20, fontWeight:800, color:'#166534', margin:'0 0 6px' }}>Imported!</h2>
        <p style={{ margin:0, fontSize:14, color:'#15803d' }}>
          {stats?.count} transactions added across{' '}
          {Object.keys(stats?.byMonth||{}).join(', ')}.
        </p>
        <p style={{ margin:'8px 0 0', fontSize:12, color:'#15803d' }}>
          Head to the Home tab — budgets update automatically, and you'll see suggested
          targets once you've imported a few months.
        </p>
      </Card>
      <button onClick={reset} style={{ border:'none', width:'100%', padding:'14px', borderRadius:14,
        fontSize:14, fontWeight:700, background:'#0f172a', color:'#fff', cursor:'pointer' }}>
        Upload another statement
      </button>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

const SUPABASE_READY = !!(
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function App() {
  const now = new Date();

  const [user,     setUser     ] = useState(null);
  const [tab,      setTab      ] = useState('home');
  const [month,    setMonth    ] = useState(now.getMonth());
  const [year,     setYear     ] = useState(now.getFullYear());
  const [txns,     setTxns     ] = useState([]);
  const [imports,  setImports  ] = useState([]);
  const [income,   setIncome   ] = useState(DEF_INCOME);
  const [ccTarget, setCcTarget ] = useState(500);
  const [loaded,   setLoaded   ] = useState(false);
  const [toast,    setToast    ] = useState(null);
  const [allImps,  setAllImps  ] = useState([]);  // for computing averages
  const [suggested,setSuggested] = useState({});

  // Load user from localStorage
  useEffect(()=>{
    const u = localStorage.getItem('hb_user');
    if (u) setUser(u);
    setLoaded(true);
  },[]);

  // Load month data + all imports
  useEffect(()=>{
    if (!loaded || !user || !SUPABASE_READY) return;
    loadAll();
  },[user,month,year,loaded]);

  async function loadAll() {
    try {
      const [t, b, s, ai] = await Promise.all([
        getTxns(year,month),
        getBankImports(year,month),
        getSettings(year,month),
        getAllBankImports(),
      ]);
      setTxns(t); setImports(b);
      setIncome(s?.income || DEF_INCOME);
      setCcTarget(s?.cc_target ?? 500);
      setAllImps(ai);
      // Compute suggested budgets from all historical imports
      if (ai.length > 10) setSuggested(computeAverages(ai));
    } catch(e) { showToast('Load error: '+e.message); }
  }

  // Real-time subscription
  useEffect(()=>{
    if (!loaded || !user || !SUPABASE_READY) return;
    const unsub = subscribeToMonth(
      year, month,
      () => getTxns(year,month).then(setTxns).catch(()=>{}),
      () => getSettings(year,month).then(s=>{ if(s){setIncome(s.income);setCcTarget(s.cc_target);} }).catch(()=>{}),
      () => getBankImports(year,month).then(setImports).catch(()=>{}),
    );
    return unsub;
  },[user,month,year,loaded]);

  async function saveSettings() {
    try { await upsertSettings(year,month,income,ccTarget); } catch {}
  }

  function showToast(msg){ setToast(msg); setTimeout(()=>setToast(null),2400); }

  async function pickUser(u) {
    localStorage.setItem('hb_user', u);
    setUser(u);
  }

  function switchUser(){
    const next = user==='jordan'?'ness':'jordan';
    localStorage.setItem('hb_user',next);
    setUser(next);
  }

  function changeMonth(dir){
    let m=month+dir, y=year;
    if(m<0){m=11;y--;} if(m>11){m=0;y++;}
    setMonth(m); setYear(y);
  }

  async function addTxn(tx) {
    const row = { ...tx, id:uid(), ts:Date.now(), year, month };
    await insertTxn(row);  // real-time subscription will update setTxns
  }

  async function removeTxn(id) {
    await deleteTxn(id);
  }

  async function removeImport(id) {
    await deleteBankImport(id);
    setImports(prev=>prev.filter(t=>t.id!==id));
  }

  function acceptSuggested() {
    // For now just show a toast — real implementation would update CATS targets
    // This is a placeholder since CATS is a static constant
    showToast('Suggestions saved — update your category targets in the app');
    setSuggested({});
  }

  if (!SUPABASE_READY) return <SetupScreen />;
  if (!loaded) return <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center',
    justifyContent:'center', background:'#f8fafc' }}><Spinner /></div>;
  if (!user) return <UserPicker onPick={pickUser} />;

  const u = USERS[user];

  const TABS = [
    {id:'home',    label:'Home',    icon:'🏠'},
    {id:'add',     label:'Add',     icon:'+'},
    {id:'history', label:'History', icon:'📋'},
    {id:'bills',   label:'Bills',   icon:'📅'},
    {id:'upload',  label:'Upload',  icon:'📥'},
  ];

  return (
    <div style={{ maxWidth:430, margin:'0 auto', minHeight:'100dvh', background:'#f8fafc', paddingBottom:72 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ background:'#fff', borderBottom:'1px solid #f1f5f9', padding:'10px 14px 8px',
        position:'sticky', top:0, zIndex:10, display:'flex', alignItems:'center', gap:8 }}>
        <button onClick={()=>changeMonth(-1)} style={{ border:'1px solid #e5e7eb', borderRadius:8,
          padding:'5px 10px', background:'#fff', fontSize:16, color:'#374151', lineHeight:1, cursor:'pointer' }}>‹</button>
        <div style={{ flex:1, textAlign:'center' }}>
          <p style={{ margin:0, fontSize:16, fontWeight:800, color:'#0f172a', letterSpacing:'-0.02em' }}>
            {MONTHS[month]} {year}
          </p>
        </div>
        <button onClick={()=>changeMonth(1)} style={{ border:'1px solid #e5e7eb', borderRadius:8,
          padding:'5px 10px', background:'#fff', fontSize:16, color:'#374151', lineHeight:1, cursor:'pointer' }}>›</button>
        <button onClick={switchUser} style={{ border:'none', borderRadius:99, padding:'5px 10px 5px 6px',
          background:u.bg, display:'flex', alignItems:'center', gap:5, marginLeft:4, cursor:'pointer' }}>
          <Avatar who={user} size={20} />
          <span style={{ fontSize:11, fontWeight:800, color:u.color }}>{u.name}</span>
        </button>
      </div>

      {/* Tab strip */}
      <div style={{ display:'flex', borderBottom:'1px solid #f1f5f9', background:'#fff',
        position:'sticky', top:50, zIndex:9 }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ flex:1, border:'none', padding:'8px 0',
            background:'none', fontSize:t.id==='add'?20:12, fontWeight:tab===t.id?800:500,
            color:tab===t.id?'#16a34a':'#94a3b8',
            borderBottom:`2px solid ${tab===t.id?'#16a34a':'transparent'}`, cursor:'pointer' }}>{t.label}</button>
        ))}
      </div>

      {/* Content */}
      {tab==='home'    && <HomeTab txns={txns} bankImports={imports} income={income} ccTarget={ccTarget}
          setIncome={setIncome} setCcTarget={setCcTarget} year={year} month={month}
          onSaveSettings={saveSettings} suggestedBudgets={suggested} onAcceptSuggested={acceptSuggested} />}
      {tab==='add'     && <AddTab user={user} onAdd={addTxn} />}
      {tab==='history' && <HistoryTab txns={txns} bankImports={imports}
          onDeleteTxn={removeTxn} onDeleteImport={removeImport} />}
      {tab==='bills'   && <BillsTab />}
      {tab==='upload'  && <UploadTab showToast={showToast} onImported={loadAll} />}

      {toast && <Toast msg={toast} />}
    </div>
  );
}
