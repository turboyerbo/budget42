import { useState, useEffect, useRef } from 'react';
import {
  ShoppingBasket, Utensils, Wine, Car, Train, Pill, Stethoscope,
  Ticket, Code2, CreditCard, Shirt, Plane, Scissors, Scale, Package,
  Home, Plus, History, CalendarDays, Upload, Tag, Coffee, Music,
  BookOpen, Camera, Dumbbell, Leaf, PawPrint, Brush, Baby,
  ChevronRight, Trash2, Check, X,
} from 'lucide-react';
import { supabase, getTxns, insertTxn, deleteTxn,
         getSettings, upsertSettings,
         getBankImports, insertBankImports, deleteBankImport, getAllBankImports,
         subscribeToMonth } from './supabase.js';
import { categorize, computeAverages } from './categorize.js';

// ─── Fonts ────────────────────────────────────────────────────────────────────
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const SANS  = "'DM Sans', system-ui, sans-serif";

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  green:      '#1a7a4a',
  greenLight: '#e8f4ee',
  greenMid:   '#2d9d61',
  ink:        '#1a1a18',
  inkMid:     '#4a4a46',
  inkSoft:    '#8a8a84',
  sand:       '#f5f3ef',
  sandMid:    '#eceae4',
  sandDark:   '#ddd9d0',
  white:      '#ffffff',
  red:        '#c0392b',
  redLight:   '#fdf0ee',
  amber:      '#b45309',
  amberLight: '#fef9ee',
  blue:       '#1d4ed8',
};

// ─── Months ───────────────────────────────────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// ─── Icon map (for custom category picker) ────────────────────────────────────
const ICON_MAP = {
  ShoppingBasket, Utensils, Wine, Car, Train, Pill, Stethoscope,
  Ticket, Code2, CreditCard, Shirt, Plane, Scissors, Scale, Package,
  Tag, Coffee, Music, BookOpen, Camera, Dumbbell, Leaf, PawPrint, Brush, Baby,
};
const PICKABLE_ICONS = Object.keys(ICON_MAP);

// ─── Default categories ───────────────────────────────────────────────────────
const DEFAULT_CATS = [
  { id:'groceries',     label:'Groceries',       icon:'ShoppingBasket', target:400,  color:C.green      },
  { id:'restaurant',    label:'Dining out',       icon:'Utensils',       target:250,  color:'#1d4ed8'    },
  { id:'alcohol',       label:'Wine & spirits',   icon:'Wine',           target:80,   color:'#7c3aed'    },
  { id:'uber',          label:'Rides',            icon:'Car',            target:80,   color:'#b45309'    },
  { id:'transit',       label:'Transit',          icon:'Train',          target:30,   color:'#0369a1'    },
  { id:'pharmacy',      label:'Pharmacy',         icon:'Pill',           target:100,  color:'#be185d'    },
  { id:'medical',       label:'Medical & dental', icon:'Stethoscope',    target:550,  color:C.red        },
  { id:'entertainment', label:'Entertainment',    icon:'Ticket',         target:50,   color:'#065f46'    },
  { id:'hobbies',       label:'Hobbies & dev',    icon:'Code2',          target:150,  color:'#4f46e5'    },
  { id:'subscriptions', label:'Subscriptions',    icon:'CreditCard',     target:155,  color:'#0891b2'    },
  { id:'clothing',      label:'Clothing',         icon:'Shirt',          target:100,  color:'#b45309'    },
  { id:'travel',        label:'Travel',           icon:'Plane',          target:200,  color:'#0e7490'    },
  { id:'salon',         label:'Salon & spa',      icon:'Scissors',       target:100,  color:'#9d174d'    },
  { id:'legal',         label:'Legal & fees',     icon:'Scale',          target:100,  color:'#57534e'    },
  { id:'other',         label:'Other',            icon:'Package',        target:200,  color:'#6b7280'    },
];

const COLOR_SWATCHES = [
  '#1a7a4a','#1d4ed8','#7c3aed','#b45309','#0369a1',
  '#be185d','#c0392b','#065f46','#4f46e5','#0891b2',
  '#9d174d','#57534e','#6b7280','#92400e','#0e7490',
];

// ─── Fixed bills & subs ───────────────────────────────────────────────────────
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

// ─── CSV source list ──────────────────────────────────────────────────────────
const SOURCES = [
  { id:'BMO',      label:'BMO Chequing'       },
  { id:'CTFS',     label:'Canadian Tire'       },
  { id:'WS_JOINT', label:'Wealthsimple Joint'  },
  { id:'PC_MC',    label:'PC Mastercard'       },
];

// ─── Users ────────────────────────────────────────────────────────────────────
const USERS = {
  jordan: { key:'jordan', name:'Jordan', initials:'JY',  color:'#1d4ed8', bg:'#eff6ff' },
  ness:   { key:'ness',   name:'Ness',   initials:'NMK', color:'#be185d', bg:'#fdf2f8' },
};

const DEF_INCOME = { jordan:3984.44, ness:800, sunlife:0 };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt     = n  => '$' + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits:2, maximumFractionDigits:2 });
const fmtK    = n  => n >= 1000 ? '$' + (n/1000).toFixed(1) + 'k' : fmt(n);
const uid     = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const today   = () => new Date().toISOString().slice(0,10);

function getMonthYear(date) {
  const d = new Date(date + 'T00:00:00');
  return { month: d.getMonth(), year: d.getFullYear() };
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCSVRow(line) {
  const cols=[]; let cur=''; let inQ=false;
  for (const ch of line) {
    if (ch==='"') { inQ=!inQ; }
    else if (ch===',' && !inQ) { cols.push(cur.trim()); cur=''; }
    else cur+=ch;
  }
  cols.push(cur.trim());
  return cols;
}

function parseStatementCSV(text, source) {
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  let headerIdx=-1, headers=[];
  for (let i=0; i<Math.min(20,lines.length); i++) {
    const raw  = parseCSVRow(lines[i]);
    const cols = raw.map(c=>c.replace(/['"]/g,'').toLowerCase().replace(/[^a-z0-9_ ]/g,'').trim());
    const hasDate = cols.some(c=>c.includes('date'));
    const hasAmt  = cols.some(c=>c==='cad'||c.startsWith('cad')||c.includes('amount')||c.includes('cash'));
    if (hasDate && hasAmt && cols.some(c=>c.length>1)) { headerIdx=i; headers=cols; break; }
  }
  if (headerIdx<0) return [];
  const dateIdx = headers.findIndex(c=>c==='transaction_date'||c==='transaction date'||c==='date'||c.includes('transaction date'));
  const descIdx = headers.findIndex(c=>c==='description'||c.includes('description')||c.includes('desc')||(c.includes('name')&&!c.includes('account')&&!c.includes('currency')));
  const amtIdx  = headers.findIndex(c=>c==='cad'||c==='cad$'||c==='amount'||c==='net_cash_amount'||c.includes('amount')||(c.startsWith('cad')&&c.length<=5));
  if (dateIdx<0||descIdx<0||amtIdx<0) return [];
  const rows=[];
  for (let i=headerIdx+1; i<lines.length; i++) {
    const cols  = parseCSVRow(lines[i]);
    if (cols.length<3) continue;
    const date  = cols[dateIdx]?.replace(/['"]/g,'').trim();
    const desc  = cols[descIdx]?.replace(/['"]/g,'').trim();
    const raw   = cols[amtIdx]?.replace(/['"$,+ ]/g,'').trim();
    if (!date||!desc||!raw||raw===''||isNaN(parseFloat(raw))) continue;
    const amount = Math.abs(parseFloat(raw));
    if (amount<0.50) continue;
    const cat = categorize(desc);
    if (cat==='_skip') continue;
    let month, year;
    try { const d=new Date(date+'T00:00:00'); if(isNaN(d.getTime())) continue; month=d.getMonth(); year=d.getFullYear(); } catch { continue; }
    rows.push({ id:uid(), date, description:desc, amount, category:cat, source, month, year });
  }
  return rows;
}

// ─── CatIcon ─────────────────────────────────────────────────────────────────
function CatIcon({ name, size=18, color='currentColor' }) {
  const Comp = ICON_MAP[name] || Package;
  return <Comp size={size} color={color} strokeWidth={1.6} />;
}

// ─── B42 Logo ─────────────────────────────────────────────────────────────────
function B42Logo({ size=48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="14" fill={C.green} />
      <text x="32" y="46" fontFamily={SERIF} fontSize="28" fontWeight="700"
        fill="white" textAnchor="middle" letterSpacing="-1">b42</text>
    </svg>
  );
}
function B42Badge() {
  return (
    <svg width="42" height="26" viewBox="0 0 68 40" xmlns="http://www.w3.org/2000/svg">
      <rect width="68" height="40" rx="8" fill={C.green}/>
      <text x="34" y="29" fontFamily={SERIF} fontSize="22" fontWeight="700"
        fill="white" textAnchor="middle" letterSpacing="-1">b42</text>
    </svg>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ who, size=28 }) {
  const u = USERS[who]||USERS.jordan;
  return <div style={{ width:size, height:size, borderRadius:'50%', background:u.color, color:'#fff',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:size*0.29, fontWeight:600, letterSpacing:'-0.02em', flexShrink:0, fontFamily:SANS }}>
    {u.initials}</div>;
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────
function Bar({ spent, target, color }) {
  const pct = Math.min((spent/Math.max(target,1))*100,100);
  return <div style={{ height:3, background:C.sandDark, borderRadius:99, overflow:'hidden' }}>
    <div style={{ height:'100%', width:`${pct}%`, borderRadius:99,
      background:spent>target?C.red:color, transition:'width 0.4s ease' }} /></div>;
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({ children, style={} }) {
  return <div style={{ background:C.white, borderRadius:16, padding:'16px 18px', marginBottom:12,
    boxShadow:'0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)', ...style }}>{children}</div>;
}

// ─── Section label ────────────────────────────────────────────────────────────
function SL({ children }) {
  return <p style={{ fontSize:11, fontWeight:600, color:C.inkSoft, textTransform:'uppercase',
    letterSpacing:'0.1em', margin:'0 0 8px', fontFamily:SANS }}>{children}</p>;
}

// ─── Divider ─────────────────────────────────────────────────────────────────
function Divider() { return <div style={{ height:1, background:C.sandMid, margin:'2px 0' }} />; }

// ─── Toast ───────────────────────────────────────────────────────────────────
function Toast({ msg }) {
  return (
    <div style={{ position:'fixed', bottom:90, left:0, right:0,
      zIndex:999, display:'flex', justifyContent:'center',
      pointerEvents:'none', animation:'fadeUp 0.2s ease' }}>
      <div style={{ background:C.ink, color:'#fff', padding:'10px 22px', borderRadius:99,
        fontSize:13, fontWeight:500, whiteSpace:'nowrap',
        boxShadow:'0 4px 16px rgba(0,0,0,0.2)', fontFamily:SANS }}>{msg}</div>
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────────────────────
function Spinner({ size=16 }) {
  return <div style={{ width:size, height:size, border:`2px solid ${C.sandDark}`,
    borderTopColor:C.green, borderRadius:'50%', animation:'spin 0.7s linear infinite',
    display:'inline-block', flexShrink:0 }} />;
}

// ─── Add Category Modal ───────────────────────────────────────────────────────
function AddCatModal({ onSave, onClose }) {
  const [label,   setLabel]   = useState('');
  const [target,  setTarget]  = useState(100);
  const [icon,    setIcon]    = useState('Tag');
  const [color,   setColor]   = useState(COLOR_SWATCHES[0]);

  return (
    <div style={{ position:'fixed', inset:0, zIndex:500, display:'flex',
      flexDirection:'column', justifyContent:'flex-end' }}>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.4)' }} />
      {/* Sheet */}
      <div style={{ position:'relative', background:C.white, borderRadius:'20px 20px 0 0',
        padding:'24px 20px 40px', animation:'slideUp 0.25s ease',
        maxHeight:'85dvh', overflowY:'auto' }}>
        <div style={{ display:'flex', alignItems:'center', marginBottom:20 }}>
          <h2 style={{ flex:1, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
            New category
          </h2>
          <button onClick={onClose} style={{ border:'none', background:'none', padding:4, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft} />
          </button>
        </div>

        {/* Name */}
        <SL>Name</SL>
        <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Pet supplies"
          style={{ width:'100%', border:`1px solid ${C.sandDark}`, borderRadius:10, padding:'12px 14px',
            fontSize:16, color:C.ink, background:C.sand, marginBottom:16, outline:'none',
            fontFamily:SANS, boxSizing:'border-box' }} />

        {/* Monthly target */}
        <SL>Monthly target</SL>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
          <span style={{ fontSize:18, color:C.inkSoft }}>$</span>
          <input type="number" value={target} onChange={e=>setTarget(parseInt(e.target.value)||0)}
            style={{ flex:1, border:`1px solid ${C.sandDark}`, borderRadius:10, padding:'12px 14px',
              fontSize:16, color:C.ink, background:C.sand, outline:'none', fontFamily:SANS }} />
        </div>

        {/* Icon picker */}
        <SL>Icon</SL>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', gap:8, marginBottom:16 }}>
          {PICKABLE_ICONS.map(k=>(
            <button key={k} onClick={()=>setIcon(k)} style={{ border:`2px solid ${icon===k?color:C.sandDark}`,
              borderRadius:10, padding:'8px 0', display:'flex', alignItems:'center', justifyContent:'center',
              background:icon===k?color+'18':C.white, cursor:'pointer' }}>
              <CatIcon name={k} size={16} color={icon===k?color:C.inkSoft} />
            </button>
          ))}
        </div>

        {/* Colour picker */}
        <SL>Colour</SL>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:24 }}>
          {COLOR_SWATCHES.map(sw=>(
            <button key={sw} onClick={()=>setColor(sw)} style={{ width:30, height:30, borderRadius:'50%',
              background:sw, border:`3px solid ${color===sw?C.ink:'transparent'}`, cursor:'pointer' }} />
          ))}
        </div>

        <button onClick={()=>{ if(label.trim()) onSave({ id:'custom_'+uid(), label:label.trim(), target, icon, color, custom:true }); }}
          disabled={!label.trim()}
          style={{ border:'none', width:'100%', padding:'15px', borderRadius:12,
            background:label.trim()?C.green:C.sandDark, color:label.trim()?C.white:C.inkSoft,
            fontSize:16, fontWeight:600, cursor:label.trim()?'pointer':'default', fontFamily:SANS }}>
          Add category
        </button>
      </div>
    </div>
  );
}

// ─── Setup screen ─────────────────────────────────────────────────────────────
function SetupScreen() {
  return (
    <div style={{ minHeight:'100dvh', display:'flex', flexDirection:'column',
      alignItems:'center', justifyContent:'center', padding:36, background:C.sand }}>
      <B42Logo size={64} />
      <h1 style={{ fontFamily:SERIF, fontSize:28, fontWeight:600, margin:'16px 0 8px', color:C.ink }}>
        Supabase not connected
      </h1>
      <p style={{ fontSize:14, color:C.inkMid, textAlign:'center', maxWidth:300, marginBottom:24, lineHeight:1.7 }}>
        Add your Supabase credentials as environment variables in Netlify, then redeploy. See DEPLOY.md for instructions.
      </p>
      <div style={{ background:C.ink, borderRadius:12, padding:'16px 20px', width:'100%', maxWidth:340,
        fontFamily:'monospace', fontSize:12, color:'#94a3b8' }}>
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
      alignItems:'center', justifyContent:'center', padding:36, background:C.sand }}>
      <B42Logo size={72} />
      <h1 style={{ fontFamily:SERIF, fontSize:36, fontWeight:600, letterSpacing:'-0.02em',
        margin:'16px 0 4px', color:C.ink }}>Budget For Two</h1>
      <p style={{ fontSize:12, color:C.green, fontWeight:600, margin:'0 0 40px',
        letterSpacing:'0.12em', textTransform:'uppercase' }}>Jordan &amp; Ness</p>
      {Object.values(USERS).map(u=>(
        <button key={u.key} onClick={()=>onPick(u.key)} style={{
          border:`1.5px solid ${u.color}22`, borderRadius:16, background:C.white,
          width:'100%', maxWidth:320, padding:'18px 20px', display:'flex', alignItems:'center',
          gap:16, marginBottom:12, cursor:'pointer',
          boxShadow:'0 2px 8px rgba(0,0,0,0.06)' }}>
          <Avatar who={u.key} size={48} />
          <div style={{ textAlign:'left' }}>
            <p style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>I'm {u.name}</p>
            <p style={{ margin:0, fontSize:13, color:C.inkSoft }}>Log expenses as {u.name}</p>
          </div>
          <ChevronRight size={18} color={C.inkSoft} style={{ marginLeft:'auto' }} />
        </button>
      ))}
      <p style={{ fontSize:11, color:C.inkSoft, marginTop:24, textAlign:'center', lineHeight:1.7 }}>
        Your choice is saved on this device.<br/>All data syncs live via Supabase.
      </p>
    </div>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({ txns, bankImports, income, ccTarget, setIncome, setCcTarget,
                   allCats, onSaveSettings, suggested, onAcceptSuggested, onAddCat, onDeleteCat }) {
  const totalIncome  = Object.values(income).reduce((a,b)=>a+b,0);
  const totalFixed   = FIXED.reduce((a,b)=>a+b.amount,0);
  const totalSubs    = SUBS.reduce((a,b)=>a+b.amount,0);
  const committed    = totalFixed + totalSubs + ccTarget;
  const allTx        = [...txns, ...bankImports];
  const txByCat      = {};
  allTx.forEach(t=>{ const k=t.category||t.cat; if(k&&k!=='_skip') txByCat[k]=(txByCat[k]||0)+t.amount; });
  const totalSpent   = Object.values(txByCat).reduce((a,b)=>a+b,0);
  const surplus      = totalIncome - committed - totalSpent;
  const jSpend       = txns.filter(t=>t.who==='jordan').reduce((a,t)=>a+t.amount,0);
  const nSpend       = txns.filter(t=>t.who==='ness').reduce((a,t)=>a+t.amount,0);
  const [showAddCat, setShowAddCat] = useState(false);

  return (
    <div style={{ padding:'16px 16px 0' }}>

      {/* Summary hero */}
      <Card style={{ background:C.green, padding:'20px 20px' }}>
        <p style={{ fontSize:11, color:'rgba(255,255,255,0.7)', textTransform:'uppercase',
          letterSpacing:'0.1em', margin:'0 0 4px', fontFamily:SANS }}>Available this month</p>
        <p style={{ fontFamily:SERIF, fontSize:44, fontWeight:600, color:'#fff', margin:'0 0 16px',
          letterSpacing:'-0.02em', lineHeight:1 }}>
          {surplus>=0?fmt(surplus):'–'+fmt(surplus)}
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
          {[['Income',fmt(totalIncome)],['Committed',fmt(committed)],['Spent',fmt(totalSpent)]].map(([l,v])=>(
            <div key={l}>
              <p style={{ margin:0, fontSize:11, color:'rgba(255,255,255,0.65)',
                textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:SANS }}>{l}</p>
              <p style={{ margin:0, fontFamily:SERIF, fontSize:18, fontWeight:600,
                color:'rgba(255,255,255,0.95)' }}>{v}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* CTFS warning */}
      <div style={{ background:C.redLight, border:`1px solid ${C.red}22`, borderRadius:14,
        padding:'12px 16px', marginBottom:12, display:'flex', gap:10, alignItems:'center' }}>
        <div style={{ flex:1 }}>
          <p style={{ margin:'0 0 2px', fontSize:13, fontWeight:600, color:C.red, fontFamily:SANS }}>
            CTFS debt — $18,933 at 22% APR
          </p>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ fontSize:12, color:'#9b2c2c', fontFamily:SANS }}>Monthly payment target: $</span>
            <input type="number" value={ccTarget}
              onChange={e=>{ const v=parseFloat(e.target.value)||0; setCcTarget(v); onSaveSettings(income,v); }}
              style={{ width:68, border:`1px solid ${C.red}44`, borderRadius:7, padding:'3px 7px',
                fontSize:13, fontWeight:600, color:C.red, background:'#fff', fontFamily:SANS }} />
          </div>
        </div>
      </div>

      {/* Budget suggestions */}
      {Object.keys(suggested||{}).length>0 && (
        <div style={{ background:C.greenLight, border:`1px solid ${C.green}33`, borderRadius:14,
          padding:'12px 16px', marginBottom:12 }}>
          <p style={{ margin:'0 0 6px', fontSize:13, fontWeight:600, color:C.green, fontFamily:SANS }}>
            Budget suggestions from your statements
          </p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
            {Object.entries(suggested).map(([catId,val])=>{
              const c=allCats.find(x=>x.id===catId); if(!c) return null;
              return <span key={catId} style={{ background:C.white, borderRadius:7, padding:'3px 10px',
                fontSize:12, fontWeight:500, color:C.green, border:`1px solid ${C.green}44` }}>
                {c.label} → {fmt(val)}
              </span>;
            })}
          </div>
          <button onClick={onAcceptSuggested} style={{ border:'none', borderRadius:8, padding:'7px 14px',
            background:C.green, color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS }}>
            Apply suggestions
          </button>
        </div>
      )}

      {/* Per-person strip */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
        {[['jordan',jSpend],['ness',nSpend]].map(([who,amt])=>{
          const u=USERS[who];
          return <div key={who} style={{ background:C.white, borderRadius:14, padding:'12px 16px',
            boxShadow:'0 1px 4px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.04)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:6 }}>
              <Avatar who={who} size={22} />
              <span style={{ fontSize:11, fontWeight:600, color:u.color, fontFamily:SANS }}>logged</span>
            </div>
            <p style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>{fmt(amt)}</p>
          </div>;
        })}
      </div>

      {/* Category spending */}
      <SL>Spending this month</SL>
      <Card style={{ padding:'8px 0' }}>
        {allCats.map((cat,i)=>{
          const spent=txByCat[cat.id]||0; const over=spent>cat.target;
          return (
            <div key={cat.id}>
              {i>0 && <Divider />}
              <div style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 18px' }}>
                <div style={{ width:32, height:32, borderRadius:9, background:cat.color+'18',
                  display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <CatIcon name={cat.icon} size={16} color={cat.color} />
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                    <span style={{ fontSize:14, color:C.ink, fontFamily:SANS, fontWeight:spent>0?500:400 }}>{cat.label}</span>
                    <div style={{ display:'flex', alignItems:'baseline', gap:4 }}>
                      <span style={{ fontFamily:SERIF, fontSize:17, fontWeight:600,
                        color:over?C.red:spent>0?C.ink:C.sandDark }}>{fmt(spent)}</span>
                      <span style={{ fontSize:11, color:C.inkSoft, fontFamily:SANS }}>{fmtK(cat.target)}</span>
                    </div>
                  </div>
                  <Bar spent={spent} target={cat.target} color={cat.color} />
                  {over && <p style={{ margin:'3px 0 0', fontSize:11, color:C.red, fontFamily:SANS }}>
                    {fmt(spent-cat.target)} over budget
                  </p>}
                </div>
                {cat.custom && (
                  <button onClick={()=>{ if(window.confirm(`Remove "${cat.label}"?`)) onDeleteCat(cat.id); }}
                    style={{ border:'none', background:'none', padding:4, cursor:'pointer', marginLeft:2, flexShrink:0 }}>
                    <X size={14} color={C.inkSoft} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {/* Add category button */}
        <Divider />
        <button onClick={()=>setShowAddCat(true)} style={{ display:'flex', alignItems:'center', gap:10,
          padding:'12px 18px', width:'100%', border:'none', background:'none', cursor:'pointer' }}>
          <div style={{ width:32, height:32, borderRadius:9, background:C.sandMid,
            display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Plus size={16} color={C.inkSoft} />
          </div>
          <span style={{ fontSize:14, color:C.inkSoft, fontFamily:SANS }}>Add category</span>
        </button>
      </Card>

      {/* Income editor */}
      <SL>Income this month</SL>
      <Card style={{ padding:'8px 0' }}>
        {[['jordan','Jordan — NORR salary (est.)'],['ness','Ness — contribution'],['sunlife','SunLife reimbursement']].map(([k,l],i)=>(
          <div key={k}>
            {i>0&&<Divider/>}
            <div style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 18px' }}>
              {k!=='sunlife'
                ? <Avatar who={k} size={30}/>
                : <div style={{ width:30, height:30, borderRadius:'50%', background:C.greenLight,
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Leaf size={14} color={C.green} />
                  </div>}
              <span style={{ flex:1, fontSize:14, color:C.ink, fontFamily:SANS }}>{l}</span>
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ fontSize:14, color:C.green, fontFamily:SERIF }}>$</span>
                <input type="number" value={income[k]}
                  onChange={e=>{ const n={...income,[k]:parseFloat(e.target.value)||0}; setIncome(n); onSaveSettings(n,ccTarget); }}
                  style={{ width:90, border:`1px solid ${C.sandDark}`, borderRadius:8, padding:'5px 8px',
                    fontSize:14, fontWeight:600, color:C.ink, textAlign:'right',
                    background:C.sand, fontFamily:SERIF, outline:'none' }} />
              </div>
            </div>
          </div>
        ))}
      </Card>

      {showAddCat && <AddCatModal onSave={cat=>{ onAddCat(cat); setShowAddCat(false); }} onClose={()=>setShowAddCat(false)} />}
    </div>
  );
}

// ─── ADD TAB ──────────────────────────────────────────────────────────────────
function AddTab({ user, allCats, onAdd }) {
  const [cat,    setCat]    = useState(null);
  const [amount, setAmount] = useState('');
  const [note,   setNote]   = useState('');
  const [date,   setDate]   = useState(today());
  const [who,    setWho]    = useState(user);
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);

  useEffect(()=>{ ref.current?.focus(); },[]);

  const can = cat && parseFloat(amount)>0;

  async function submit() {
    if (!can||saving) return;
    setSaving(true);
    await onAdd({ cat, amount:parseFloat(amount), note:note.trim(), date, who });
    setCat(null); setAmount(''); setNote(''); setDate(today());
    setSaving(false); ref.current?.focus();
  }

  const selCat = allCats.find(c=>c.id===cat);

  return (
    <div style={{ padding:'16px 16px 0' }}>
      {/* Amount hero */}
      <Card style={{ textAlign:'center', padding:'24px 16px' }}>
        <p style={{ margin:'0 0 8px', fontSize:11, color:C.inkSoft, textTransform:'uppercase',
          letterSpacing:'0.1em', fontFamily:SANS }}>Amount</p>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
          <span style={{ fontFamily:SERIF, fontSize:36, fontWeight:400, color:C.sandDark, lineHeight:1 }}>$</span>
          <input ref={ref} type="number" inputMode="decimal" placeholder="0.00" value={amount}
            onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{ fontFamily:SERIF, fontSize:56, fontWeight:600, color:C.ink, border:'none',
              outline:'none', background:'none', width:200, textAlign:'center',
              letterSpacing:'-0.03em', lineHeight:1 }} />
        </div>
        {can && <p style={{ margin:'8px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
          {selCat?.label} · {fmt(parseFloat(amount))}
        </p>}
      </Card>

      {/* Category grid */}
      <SL>Category</SL>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:16 }}>
        {allCats.map(c=>(
          <button key={c.id} onClick={()=>setCat(c.id)} style={{
            border:`1.5px solid ${cat===c.id?c.color:C.sandDark}`, borderRadius:12,
            padding:'10px 8px 8px', display:'flex', flexDirection:'column', alignItems:'center', gap:6,
            background:cat===c.id?c.color+'15':C.white, cursor:'pointer', transition:'all 0.12s' }}>
            <CatIcon name={c.icon} size={20} color={cat===c.id?c.color:C.inkSoft} />
            <span style={{ fontSize:11, fontWeight:cat===c.id?600:400,
              color:cat===c.id?c.color:C.inkMid, textAlign:'center', lineHeight:1.2, fontFamily:SANS }}>
              {c.label}
            </span>
          </button>
        ))}
      </div>

      {/* Note, date, who */}
      <Card style={{ padding:'0' }}>
        <div style={{ padding:'14px 18px' }}>
          <input type="text" placeholder="Note (optional)" value={note}
            onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{ width:'100%', border:'none', outline:'none', fontSize:16, color:C.ink,
              background:'none', fontFamily:SANS, caretColor:C.green }} />
        </div>
        <Divider />
        <div style={{ padding:'12px 18px', display:'flex', gap:12, alignItems:'center' }}>
          <div style={{ flex:1 }}>
            <p style={{ margin:'0 0 3px', fontSize:11, color:C.inkSoft, textTransform:'uppercase',
              letterSpacing:'0.08em', fontFamily:SANS }}>Date</p>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              style={{ border:'none', outline:'none', fontSize:14, color:C.ink,
                background:'none', fontFamily:SANS }} />
          </div>
          <div>
            <p style={{ margin:'0 0 6px', fontSize:11, color:C.inkSoft, textTransform:'uppercase',
              letterSpacing:'0.08em', fontFamily:SANS }}>Added by</p>
            <div style={{ display:'flex', gap:6 }}>
              {Object.values(USERS).map(u=>(
                <button key={u.key} onClick={()=>setWho(u.key)} style={{
                  border:`1.5px solid ${who===u.key?u.color:C.sandDark}`, borderRadius:8, padding:'5px 12px',
                  fontSize:12, fontWeight:600, background:who===u.key?u.color:C.white,
                  color:who===u.key?'#fff':C.inkMid, cursor:'pointer', fontFamily:SANS }}>{u.name}</button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <button onClick={submit} disabled={!can||saving} style={{ border:'none', width:'100%',
        padding:'16px', borderRadius:14, fontSize:16, fontWeight:600, cursor:can?'pointer':'default',
        background:can?C.green:C.sandDark, color:can?'#fff':C.inkSoft, fontFamily:SANS,
        display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:8 }}>
        {saving?<><Spinner/>Saving…</>:can?`Add ${fmt(parseFloat(amount))} to ${selCat?.label}`:'Select a category and enter an amount'}
      </button>
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────────────────────
function HistoryTab({ txns, bankImports, allCats, onDeleteTxn, onDeleteImport }) {
  const [filter, setFilter] = useState('all');
  const [srcFil, setSrcFil] = useState('all');

  const all = [
    ...txns.map(t=>({...t,_type:'manual'})),
    ...bankImports.map(t=>({...t,_type:'import',who:t.who||'jordan'})),
  ]
    .filter(t=>filter==='all'||t.who===filter)
    .filter(t=>srcFil==='all'||(srcFil==='manual'&&t._type==='manual')||(srcFil==='import'&&t._type==='import'))
    .sort((a,b)=>new Date(b.date)-new Date(a.date));

  const grouped={};
  all.forEach(t=>{
    const label=new Date(t.date+'T00:00:00').toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
    if(!grouped[label]) grouped[label]=[];
    grouped[label].push(t);
  });

  const total=all.reduce((a,t)=>a+t.amount,0);

  return (
    <div style={{ padding:'16px 16px 0' }}>
      {/* Filters */}
      <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
        {[['all','Everyone'],['jordan','Jordan'],['ness','Ness']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{ border:'none', padding:'6px 14px',
            borderRadius:99, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS,
            background:filter===k?C.ink:'transparent',
            color:filter===k?'#fff':C.inkSoft,
            outline:filter===k?'none':`1px solid ${C.sandDark}` }}>{l}</button>
        ))}
        {[['all','All'],['manual','Manual'],['import','Imported']].map(([k,l])=>(
          <button key={k} onClick={()=>setSrcFil(k)} style={{ border:'none', padding:'6px 14px',
            borderRadius:99, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:SANS,
            background:srcFil===k?'#4f46e5':'transparent',
            color:srcFil===k?'#fff':C.inkSoft,
            outline:srcFil===k?'none':`1px solid ${C.sandDark}` }}>{l}</button>
        ))}
      </div>
      {all.length>0 && (
        <p style={{ textAlign:'right', fontSize:12, color:C.inkSoft, margin:'0 0 8px', fontFamily:SANS }}>
          {all.length} entries · <span style={{ fontFamily:SERIF, fontWeight:600, fontSize:14, color:C.ink }}>{fmt(total)}</span>
        </p>
      )}

      {all.length===0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', color:C.inkSoft }}>
          <Package size={40} color={C.sandDark} style={{ marginBottom:12 }} />
          <p style={{ fontFamily:SERIF, fontSize:20, color:C.inkMid }}>No transactions yet</p>
          <p style={{ fontSize:13, marginTop:4 }}>Tap the + tab to add your first entry</p>
        </div>
      ) : (
        Object.entries(grouped).map(([day,items])=>(
          <div key={day}>
            <p style={{ margin:'0 0 6px', fontSize:11, color:C.inkSoft, fontWeight:600,
              textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:SANS }}>{day}</p>
            <Card style={{ padding:'4px 0', marginBottom:10 }}>
              {items.map((tx,i)=>{
                const catId=tx.cat||tx.category;
                const c=allCats.find(x=>x.id===catId)||{ icon:'Package', color:C.inkSoft, label:'Other' };
                return (
                  <div key={tx.id}>
                    {i>0&&<Divider/>}
                    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 16px' }}>
                      <div style={{ width:34, height:34, borderRadius:10, background:c.color+'18',
                        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <CatIcon name={c.icon} size={16} color={c.color} />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ margin:0, fontSize:14, fontWeight:500, color:C.ink, fontFamily:SANS,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {tx.note||tx.description||c.label}
                        </p>
                        <p style={{ margin:0, fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                          {tx._type==='import'?`Imported · ${tx.source}`:c.label}
                        </p>
                      </div>
                      <Avatar who={tx.who||'jordan'} size={22}/>
                      <p style={{ margin:0, fontFamily:SERIF, fontSize:17, fontWeight:600, color:C.ink,
                        fontVariantNumeric:'tabular-nums', minWidth:64, textAlign:'right' }}>{fmt(tx.amount)}</p>
                      <button onClick={()=>{ if(window.confirm('Remove?'))
                          tx._type==='import'?onDeleteImport(tx.id):onDeleteTxn(tx.id); }}
                        style={{ border:'none', background:'none', cursor:'pointer', padding:'4px', flexShrink:0 }}>
                        <Trash2 size={14} color={C.sandDark} />
                      </button>
                    </div>
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
  const tc={bill:C.blue,sub:'#7c3aed',medical:C.red,debt:C.red};
  const tl={bill:'Bill',sub:'Sub',medical:'Medical',debt:'Debt'};
  return (
    <div style={{ padding:'16px 16px 0' }}>
      <SL>Upcoming — next 30 days</SL>
      <Card style={{ padding:'4px 0' }}>
        {UPCOMING.map((item,i)=>(
          <div key={i}>
            {i>0&&<Divider/>}
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 18px',
              background:item.crit?C.redLight:C.white, borderRadius:item.crit?10:0 }}>
              <div style={{ flex:1 }}>
                <p style={{ margin:0, fontSize:14, fontWeight:item.crit?600:500,
                  color:item.crit?C.red:C.ink, fontFamily:SANS }}>{item.label}</p>
                <p style={{ margin:'2px 0 0', fontSize:12, color:item.crit?C.red+'99':C.inkSoft,
                  fontFamily:SANS }}>{item.date}</p>
              </div>
              <span style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:99,
                background:(tc[item.type]||C.inkSoft)+'18', color:tc[item.type]||C.inkSoft,
                fontFamily:SANS }}>{tl[item.type]||item.type}</span>
              <p style={{ margin:0, fontFamily:SERIF, fontSize:16, fontWeight:600,
                color:item.crit?C.red:C.ink, fontVariantNumeric:'tabular-nums' }}>{fmt(item.amount)}</p>
            </div>
          </div>
        ))}
      </Card>

      <SL>Monthly fixed — {fmt(FIXED.reduce((a,b)=>a+b.amount,0))}/mo</SL>
      <Card style={{ padding:'4px 0' }}>
        {FIXED.map((f,i)=>(
          <div key={i}>
            {i>0&&<Divider/>}
            <div style={{ display:'flex', padding:'11px 18px' }}>
              <span style={{ flex:1, fontSize:14, color:C.ink, fontFamily:SANS }}>{f.label}</span>
              <span style={{ fontSize:12, color:C.inkSoft, marginRight:12, fontFamily:SANS }}>{f.due}</span>
              <span style={{ fontFamily:SERIF, fontSize:16, fontWeight:600, color:C.ink }}>{fmt(f.amount)}</span>
            </div>
          </div>
        ))}
      </Card>

      <SL>Subscriptions — {fmt(SUBS.reduce((a,b)=>a+b.amount,0))}/mo</SL>
      <Card style={{ padding:'4px 0' }}>
        {SUBS.map((s,i)=>(
          <div key={i}>
            {i>0&&<Divider/>}
            <div style={{ display:'flex', padding:'11px 18px' }}>
              <span style={{ flex:1, fontSize:14, color:C.ink, fontFamily:SANS }}>{s.label}</span>
              <span style={{ fontSize:12, color:C.inkSoft, marginRight:12, fontFamily:SANS }}>{s.due}</span>
              <span style={{ fontFamily:SERIF, fontSize:16, fontWeight:600, color:C.ink }}>{fmt(s.amount)}</span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── UPLOAD TAB ───────────────────────────────────────────────────────────────
function UploadTab({ showToast, onImported, allCats }) {
  const [step,    setStep]    = useState('pick');
  const [source,  setSource]  = useState('BMO');
  const [who,     setWho]     = useState('jordan');
  const [parsed,  setParsed]  = useState([]);
  const [edits,   setEdits]   = useState({});
  const [saving,  setSaving]  = useState(false);
  const [stats,   setStats]   = useState(null);
  const fileRef = useRef(null);

  function handleFile(e) {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const rows=parseStatementCSV(ev.target.result,source);
      if(rows.length===0){ showToast('No transactions found — check file format'); return; }
      setParsed(rows.map(r=>({...r,who}))); setEdits({}); setStep('review');
    };
    reader.readAsText(file); e.target.value='';
  }

  const toImport = parsed.filter(r=>!edits[r.id]?.skip)
    .map(r=>({...r, category:edits[r.id]?.cat||r.category}));
  const skipped  = parsed.length-toImport.length;

  const byMonth={};
  parsed.forEach(r=>{ const k=`${MONTHS[r.month]} ${r.year}`; if(!byMonth[k]) byMonth[k]=[]; byMonth[k].push(r); });

  async function confirmImport() {
    setSaving(true);
    try {
      await insertBankImports(toImport);
      setStats({ count:toImport.length, months:Object.keys(byMonth) });
      setStep('done'); onImported();
      showToast(`Imported ${toImport.length} transactions`);
    } catch(err) { showToast('Import failed — '+err.message); }
    setSaving(false);
  }

  if (step==='pick') return (
    <div style={{ padding:'16px 16px 0' }}>
      <div style={{ background:C.greenLight, border:`1px solid ${C.green}33`, borderRadius:14,
        padding:'14px 16px', marginBottom:16 }}>
        <p style={{ margin:'0 0 4px', fontSize:14, fontWeight:600, color:C.green, fontFamily:SANS }}>
          Upload a bank statement
        </p>
        <p style={{ margin:0, fontSize:13, color:C.green+'cc', fontFamily:SANS, lineHeight:1.6 }}>
          Any CSV from BMO, CTFS, WS, or PC MC. Transactions are auto-categorised and added across the right months.
        </p>
      </div>

      <SL>Source account</SL>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
        {SOURCES.map(s=>(
          <button key={s.id} onClick={()=>setSource(s.id)} style={{ border:`1.5px solid ${source===s.id?C.blue:C.sandDark}`,
            borderRadius:12, padding:'12px 14px', background:source===s.id?'#eff6ff':C.white,
            cursor:'pointer', fontSize:13, fontWeight:600,
            color:source===s.id?C.blue:C.inkMid, textAlign:'left', fontFamily:SANS }}>{s.label}</button>
        ))}
      </div>

      <SL>Spending belongs to</SL>
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        {Object.values(USERS).map(u=>(
          <button key={u.key} onClick={()=>setWho(u.key)} style={{ flex:1, border:`1.5px solid ${who===u.key?u.color:C.sandDark}`,
            borderRadius:12, padding:'11px', background:who===u.key?u.bg:C.white, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <Avatar who={u.key} size={24}/>
            <span style={{ fontSize:13, fontWeight:600, color:who===u.key?u.color:C.inkMid, fontFamily:SANS }}>{u.name}</span>
          </button>
        ))}
      </div>

      <input ref={fileRef} type="file" accept=".csv,.CSV" onChange={handleFile} style={{ display:'none' }}/>
      <button onClick={()=>fileRef.current?.click()} style={{ border:'none', width:'100%', padding:'16px',
        borderRadius:14, fontSize:16, fontWeight:600, background:C.ink, color:'#fff', cursor:'pointer',
        display:'flex', alignItems:'center', justifyContent:'center', gap:10, fontFamily:SANS }}>
        <Upload size={18}/> Choose CSV file
      </button>
      <p style={{ textAlign:'center', fontSize:12, color:C.inkSoft, marginTop:10, fontFamily:SANS }}>
        Supports BMO, CTFS, Wealthsimple, and PC Mastercard exports
      </p>
    </div>
  );

  if (step==='review') return (
    <div style={{ padding:'16px 16px 0' }}>
      <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center' }}>
        <button onClick={()=>{ setStep('pick'); setParsed([]); setEdits({}); }}
          style={{ border:`1px solid ${C.sandDark}`, borderRadius:8, padding:'6px 12px',
            background:C.white, fontSize:13, color:C.ink, cursor:'pointer', fontFamily:SANS }}>← Back</button>
        <div style={{ flex:1 }}>
          <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.ink, fontFamily:SANS }}>
            {parsed.length} transactions found
          </p>
          <p style={{ margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS }}>
            {toImport.length} to import · {skipped} skipped
          </p>
        </div>
        <button onClick={confirmImport} disabled={saving||toImport.length===0}
          style={{ border:'none', borderRadius:10, padding:'8px 16px', cursor:'pointer', fontFamily:SANS,
            background:toImport.length>0?C.green:C.sandDark,
            color:toImport.length>0?'#fff':C.inkSoft, fontSize:13, fontWeight:600,
            display:'flex', alignItems:'center', gap:6 }}>
          {saving?<><Spinner size={14}/>…</>:'Import'}
        </button>
      </div>

      {Object.entries(byMonth).map(([mk,rows])=>(
        <div key={mk}>
          <SL>{mk} · {rows.length} transactions</SL>
          <Card style={{ padding:'4px 0', marginBottom:12 }}>
            {rows.map((tx,i)=>{
              const editedCat=edits[tx.id]?.cat||tx.category;
              const skp=edits[tx.id]?.skip||false;
              const c=allCats.find(x=>x.id===editedCat)||{icon:'Package',color:C.inkSoft};
              return (
                <div key={tx.id}>
                  {i>0&&<Divider/>}
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px',
                    opacity:skp?0.4:1, background:skp?C.sandMid:'transparent' }}>
                    <button onClick={()=>setEdits(p=>({...p,[tx.id]:{...p[tx.id],skip:!p[tx.id]?.skip}}))}
                      style={{ border:'none', background:'none', padding:0, cursor:'pointer', flexShrink:0 }}>
                      <div style={{ width:20, height:20, borderRadius:5, border:`1.5px solid ${skp?C.sandDark:C.green}`,
                        background:skp?'transparent':C.green, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {!skp&&<Check size={12} color="#fff" strokeWidth={3}/>}
                      </div>
                    </button>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:12, color:C.ink, fontFamily:SANS,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{tx.description}</p>
                      <p style={{ margin:0, fontSize:11, color:C.inkSoft, fontFamily:SANS }}>{tx.date}</p>
                    </div>
                    <select value={editedCat} onChange={e=>setEdits(p=>({...p,[tx.id]:{...p[tx.id],cat:e.target.value}}))}
                      style={{ border:`1px solid ${c.color}`, borderRadius:7, padding:'3px 6px',
                        fontSize:10, fontWeight:600, color:c.color, background:'#fff',
                        cursor:'pointer', fontFamily:SANS, maxWidth:100 }}>
                      {allCats.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                    <p style={{ margin:0, fontFamily:SERIF, fontSize:15, fontWeight:600, color:C.ink,
                      minWidth:58, textAlign:'right' }}>{fmt(tx.amount)}</p>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      ))}

      <button onClick={confirmImport} disabled={saving||toImport.length===0}
        style={{ border:'none', width:'100%', padding:'16px', borderRadius:14, fontSize:15, fontWeight:600,
          background:toImport.length>0?C.green:C.sandDark, color:toImport.length>0?'#fff':C.inkSoft,
          cursor:toImport.length>0?'pointer':'default', fontFamily:SANS,
          display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:16 }}>
        {saving?<><Spinner/>Importing…</>:`Import ${toImport.length} transactions`}
      </button>
    </div>
  );

  return (
    <div style={{ padding:'16px 16px 0' }}>
      <Card style={{ background:C.greenLight, border:`1px solid ${C.green}33`, textAlign:'center', padding:'32px 20px' }}>
        <div style={{ display:'flex', justifyContent:'center', marginBottom:12 }}>
          <Check size={48} color={C.green} />
        </div>
        <h2 style={{ fontFamily:SERIF, fontSize:26, fontWeight:600, color:C.green, margin:'0 0 8px' }}>Imported</h2>
        <p style={{ margin:0, fontSize:14, color:C.green+'cc', fontFamily:SANS }}>
          {stats?.count} transactions added across {stats?.months?.join(', ')}.
        </p>
      </Card>
      <button onClick={()=>{ setStep('pick'); setParsed([]); setEdits({}); setStats(null); }}
        style={{ border:'none', width:'100%', padding:'15px', borderRadius:14,
          fontSize:14, fontWeight:600, background:C.ink, color:'#fff', cursor:'pointer', fontFamily:SANS }}>
        Upload another statement
      </button>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
const SUPABASE_READY = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
const CUSTOM_CATS_KEY = 'b42_custom_cats';

export default function App() {
  const now = new Date();
  const [user,       setUser      ] = useState(null);
  const [tab,        setTab       ] = useState('home');
  const [month,      setMonth     ] = useState(now.getMonth());
  const [year,       setYear      ] = useState(now.getFullYear());
  const [txns,       setTxns      ] = useState([]);
  const [imports,    setImports   ] = useState([]);
  const [income,     setIncome    ] = useState(DEF_INCOME);
  const [ccTarget,   setCcTarget  ] = useState(500);
  const [loaded,     setLoaded    ] = useState(false);
  const [toast,      setToast     ] = useState(null);
  const [allImps,    setAllImps   ] = useState([]);
  const [suggested,  setSuggested ] = useState({});
  const [customCats, setCustomCats] = useState([]);

  // Load custom categories from localStorage
  useEffect(()=>{
    try { const s=localStorage.getItem(CUSTOM_CATS_KEY); if(s) setCustomCats(JSON.parse(s)); } catch {}
  },[]);

  const allCats = [...DEFAULT_CATS, ...customCats];

  // Load user
  useEffect(()=>{
    const u=localStorage.getItem('hb_user'); if(u) setUser(u);
    setLoaded(true);
  },[]);

  // Load month data
  useEffect(()=>{
    if(!loaded||!user||!SUPABASE_READY) return;
    loadAll();
  },[user,month,year,loaded]);

  async function loadAll() {
    try {
      const [t,b,s,ai]=await Promise.all([getTxns(year,month),getBankImports(year,month),getSettings(year,month),getAllBankImports()]);
      setTxns(t); setImports(b);
      setIncome(s?.income||DEF_INCOME); setCcTarget(s?.cc_target??500);
      setAllImps(ai);
      if(ai.length>10) setSuggested(computeAverages(ai));
    } catch(e){ showToast('Load error: '+e.message); }
  }

  // Real-time
  useEffect(()=>{
    if(!loaded||!user||!SUPABASE_READY) return;
    const unsub=subscribeToMonth(year,month,
      ()=>getTxns(year,month).then(setTxns).catch(()=>{}),
      ()=>getSettings(year,month).then(s=>{if(s){setIncome(s.income);setCcTarget(s.cc_target);}}).catch(()=>{}),
      ()=>getBankImports(year,month).then(setImports).catch(()=>{}),
    );
    return unsub;
  },[user,month,year,loaded]);

  // Accept explicit values to avoid React stale-state closure bugs.
  // Always call as saveSettings(latestIncome, latestCC) from event handlers.
  const saveSettingsRef = useRef(null);
  async function saveSettings(incomeVal, ccVal) {
    const inc = incomeVal ?? income;
    const cc  = ccVal     ?? ccTarget;
    // Debounce: clear any pending save and schedule a new one
    if (saveSettingsRef.current) clearTimeout(saveSettingsRef.current);
    saveSettingsRef.current = setTimeout(async () => {
      try { await upsertSettings(year, month, inc, cc); } catch {}
    }, 800);
  }

  function showToast(msg){ setToast(msg); setTimeout(()=>setToast(null),2600); }

  async function pickUser(u){ localStorage.setItem('hb_user',u); setUser(u); }

  function switchUser(){
    const next=user==='jordan'?'ness':'jordan';
    localStorage.setItem('hb_user',next); setUser(next);
  }

  function changeMonth(dir){ let m=month+dir,y=year; if(m<0){m=11;y--;} if(m>11){m=0;y++;} setMonth(m);setYear(y); }

  async function addTxn(tx){ await insertTxn({...tx,id:uid(),ts:Date.now(),year,month}); }
  async function removeTxn(id){ await deleteTxn(id); }
  async function removeImport(id){ await deleteBankImport(id); setImports(p=>p.filter(t=>t.id!==id)); }

  function addCustomCat(cat) {
    const updated=[...customCats,cat];
    setCustomCats(updated);
    localStorage.setItem(CUSTOM_CATS_KEY,JSON.stringify(updated));
    showToast(`"${cat.label}" added`);
  }

  function deleteCustomCat(id) {
    const updated=customCats.filter(c=>c.id!==id);
    setCustomCats(updated);
    localStorage.setItem(CUSTOM_CATS_KEY,JSON.stringify(updated));
  }

  function acceptSuggested(){ setSuggested({}); showToast('Budget targets noted — edit in the income section'); }

  if(!SUPABASE_READY) return <SetupScreen />;
  if(!loaded) return <div style={{ minHeight:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:C.sand }}><Spinner size={28}/></div>;
  if(!user) return <UserPicker onPick={pickUser}/>;

  const u=USERS[user];

  const NAV=[
    {id:'home',    label:'Home',    Icon:Home     },
    {id:'add',     label:'Add',     Icon:Plus,    accent:true},
    {id:'history', label:'History', Icon:History  },
    {id:'bills',   label:'Bills',   Icon:CalendarDays},
    {id:'upload',  label:'Upload',  Icon:Upload   },
  ];

  return (
    <div style={{ maxWidth:560, margin:'0 auto', minHeight:'100dvh', background:C.sand,
      paddingBottom:'calc(72px + env(safe-area-inset-bottom, 0px))' }}>

      {/* ── Sticky header ───────────────────────────────────────────── */}
      <div style={{ background:C.white, borderBottom:`1px solid ${C.sandMid}`,
        padding:'10px 16px', position:'sticky', top:0, zIndex:50,
        display:'flex', alignItems:'center', gap:10 }}>
        <B42Badge />
        <button onClick={()=>changeMonth(-1)} style={{ border:`1px solid ${C.sandDark}`, borderRadius:8,
          padding:'5px 10px', background:C.white, fontSize:16, color:C.inkMid, lineHeight:1, cursor:'pointer' }}>‹</button>
        <p style={{ flex:1, margin:0, fontFamily:SERIF, fontSize:17, fontWeight:600,
          color:C.ink, textAlign:'center', letterSpacing:'-0.01em' }}>{MONTHS[month]} {year}</p>
        <button onClick={()=>changeMonth(1)} style={{ border:`1px solid ${C.sandDark}`, borderRadius:8,
          padding:'5px 10px', background:C.white, fontSize:16, color:C.inkMid, lineHeight:1, cursor:'pointer' }}>›</button>
        <button onClick={switchUser} style={{ border:'none', borderRadius:99,
          padding:'5px 10px 5px 7px', background:u.bg, display:'flex', alignItems:'center',
          gap:6, cursor:'pointer' }}>
          <Avatar who={user} size={20}/>
          <span style={{ fontSize:11, fontWeight:700, color:u.color, fontFamily:SANS }}>{u.name}</span>
        </button>
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      {tab==='home'    && <HomeTab txns={txns} bankImports={imports} income={income} ccTarget={ccTarget}
          setIncome={setIncome} setCcTarget={setCcTarget} allCats={allCats}
          onSaveSettings={saveSettings} suggested={suggested} onAcceptSuggested={acceptSuggested}
          onAddCat={addCustomCat} onDeleteCat={deleteCustomCat} />}
      {tab==='add'     && <AddTab user={user} allCats={allCats} onAdd={async tx=>{ await addTxn(tx); showToast(`Added ${fmt(tx.amount)}`); setTab('home'); }} />}
      {tab==='history' && <HistoryTab txns={txns} bankImports={imports} allCats={allCats}
          onDeleteTxn={removeTxn} onDeleteImport={removeImport} />}
      {tab==='bills'   && <BillsTab />}
      {tab==='upload'  && <UploadTab showToast={showToast} onImported={loadAll} allCats={allCats} />}

      {/* ── Bottom nav ──────────────────────────────────────────────── */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, background:C.white,
        borderTop:`1px solid ${C.sandMid}`,
        paddingBottom:'env(safe-area-inset-bottom, 0px)', zIndex:50 }}>
        <div style={{ maxWidth:560, margin:'0 auto', display:'flex' }}>
        {NAV.map(({id,label,Icon,accent})=>(
          <button key={id} onClick={()=>setTab(id)} style={{ flex:1, border:'none', background:'none',
            padding:'10px 0 12px', display:'flex', flexDirection:'column', alignItems:'center', gap:3,
            cursor:'pointer' }}>
            {accent
              ? <div style={{ width:44, height:44, borderRadius:'50%', background:tab==='add'?C.green:C.inkSoft,
                  display:'flex', alignItems:'center', justifyContent:'center', marginTop:-8,
                  boxShadow:tab==='add'?`0 4px 16px ${C.green}55`:'none', transition:'all 0.2s' }}>
                  <Icon size={20} color="#fff" />
                </div>
              : <Icon size={22} color={tab===id?C.green:C.sandDark} strokeWidth={tab===id?2:1.5}/>}
            {!accent && <span style={{ fontSize:10, fontFamily:SANS, fontWeight:tab===id?600:400,
              color:tab===id?C.green:C.inkSoft, letterSpacing:'0.02em' }}>{label}</span>}
          </button>
        ))}
        </div>
      </div>

      {toast && <Toast msg={toast}/>}
    </div>
  );
}
