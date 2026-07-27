import { useState, useEffect, useRef } from 'react';
import {
  ShoppingBasket, Utensils, Wine, Car, Train, Pill, Stethoscope,
  Ticket, Code2, CreditCard, Shirt, Plane, Scissors, Scale, Package,
  Home, Plus, History, CalendarDays, Upload, PieChart,
  Tag, Coffee, Music, BookOpen, Camera, Dumbbell, Leaf, PawPrint, Brush, Baby,
  ChevronRight, Trash2, Check, X, Sparkles, AlertCircle, Eye, EyeOff, LogOut,
  Bell, BellRing,
} from 'lucide-react';
import { supabase, getTxns, insertTxn, deleteTxn,
         getSettings, upsertSettings,
         getBankImports, insertBankImports, deleteBankImport, getAllBankImports,
         updateBankImport, updateTransaction, getOtherImports,
         subscribeToMonth, subscribeToPartnerActivity,
         signUp, signIn, signOut, onAuthChange, updateUserMeta,
         getAllBankImportsRaw } from './supabase.js';
import { categorize } from './categorize.js';
import { parseStatementCSV } from './parse.js';
import { aiCategorize, AI_AVAILABLE, computeTargets, suggestCategory } from './ai.js';
import { parsePDFStatement, PDF_AVAILABLE } from './pdf.js';
import { buildValidationReport } from './validate.js';

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  green:'#1a7a4a', greenLight:'#e8f4ee', greenMid:'#2d9d61',
  ink:'#1a1a18', inkMid:'#4a4a46', inkSoft:'#8a8a84',
  sand:'#f5f3ef', sandMid:'#eceae4', sandDark:'#ddd9d0', white:'#ffffff',
  red:'#c0392b', redLight:'#fdf0ee', blue:'#1d4ed8', amber:'#b45309',
  purple:'#7c3aed',
};
const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif";
const SANS  = "'DM Sans', system-ui, sans-serif";
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ─── Categories ───────────────────────────────────────────────────────────────
const DEFAULT_CATS = [
  {id:'groceries',    label:'Groceries',      icon:'ShoppingBasket', target:400, color:'#1a7a4a'},
  {id:'restaurant',   label:'Dining out',     icon:'Utensils',       target:250, color:'#1d4ed8'},
  {id:'alcohol',      label:'Wine & spirits', icon:'Wine',           target:80,  color:'#7c3aed'},
  {id:'uber',         label:'Rides',          icon:'Car',            target:80,  color:'#b45309'},
  {id:'transit',      label:'Transit',        icon:'Train',          target:30,  color:'#0369a1'},
  {id:'pharmacy',     label:'Pharmacy',       icon:'Pill',           target:100, color:'#be185d'},
  {id:'medical',      label:'Medical',        icon:'Stethoscope',    target:550, color:'#c0392b'},
  {id:'entertainment',label:'Entertainment',  icon:'Ticket',         target:50,  color:'#065f46'},
  {id:'hobbies',      label:'Hobbies & dev',  icon:'Code2',          target:150, color:'#4f46e5'},
  {id:'subscriptions',label:'Subscriptions',  icon:'CreditCard',     target:155, color:'#0891b2'},
  {id:'clothing',     label:'Clothing',       icon:'Shirt',          target:100, color:'#b45309'},
  {id:'travel',       label:'Travel',         icon:'Plane',          target:200, color:'#0e7490'},
  {id:'salon',        label:'Salon & spa',    icon:'Scissors',       target:100, color:'#9d174d'},
  {id:'legal',        label:'Legal & fees',   icon:'Scale',          target:100, color:'#57534e'},
  {id:'other',        label:'Other',          icon:'Package',        target:200, color:'#6b7280'},
];
const COLOR_SWATCHES = ['#1a7a4a','#1d4ed8','#7c3aed','#b45309','#0369a1',
  '#be185d','#c0392b','#065f46','#4f46e5','#0891b2','#9d174d','#57534e','#6b7280'];
const ICON_MAP = {
  ShoppingBasket,Utensils,Wine,Car,Train,Pill,Stethoscope,Ticket,Code2,CreditCard,
  Shirt,Plane,Scissors,Scale,Package,Tag,Coffee,Music,BookOpen,Camera,Dumbbell,Leaf,PawPrint,Brush,Baby,
};
const PICKABLE_ICONS = Object.keys(ICON_MAP);

const FIXED = [
  {label:'Rent (STELA)',         amount:1900,  due:'Last day'},
  {label:'Electricity (Metergy)',amount:150,   due:'~15th'},
  {label:'TD Insurance',         amount:66.50, due:'End of month'},
  {label:'Freedom Mobile',       amount:45.20, due:'~20th'},
  {label:'Affirm Canada',        amount:51.51, due:'~23rd'},
  {label:'BMO Plan Fee',         amount:17.95, due:'Last day'},
];
const SUBS = [
  {label:'Claude.ai',      amount:31.64,due:'~30th'},
  {label:'Apple (iCloud+)',amount:29.70,due:'~15th'},
  {label:'YouTube Premium',amount:25.98,due:'~22nd'},
  {label:'Dropbox',        amount:18.07,due:'~23rd'},
  {label:'Amazon Prime',   amount:11.29,due:'~19th'},
  {label:'Netflix',        amount:9.03, due:'~2nd'},
  {label:'Google One',     amount:7.90, due:'~29th'},
  {label:'Uber One',       amount:6.77, due:'~6th'},
  {label:'Anthropic API',  amount:12.00,due:'varies'},
  {label:'Prime Video',    amount:3.38, due:'~29th'},
];
const UPCOMING = [
  {label:'Rent',               amount:1900, date:'Jul 31',crit:true, type:'bill'},
  {label:'Centre for Mindbody',amount:275,  date:'Jul 21',crit:false,type:'medical'},
  {label:'YouTube Premium',    amount:25.98,date:'Jul 22',crit:false,type:'sub'},
  {label:'Affirm Canada',      amount:51.51,date:'Jul 23',crit:false,type:'bill'},
  {label:'Claude.ai',          amount:31.64,date:'Jul 30',crit:false,type:'sub'},
  {label:'TD Insurance',       amount:66.50,date:'Jul 31',crit:false,type:'bill'},
  {label:'BMO Plan Fee',       amount:17.95,date:'Jul 31',crit:false,type:'bill'},
  {label:'CTFS finance charge',amount:438,  date:'Aug 10',crit:true, type:'debt'},
  {label:'Netflix',            amount:9.03, date:'Aug 2', crit:false,type:'sub'},
  {label:'Freedom Mobile',     amount:45.20,date:'Aug 20',crit:false,type:'bill'},
];
const SOURCES = [
  {id:'BMO',     label:'BMO Chequing'},
  {id:'CTFS',    label:'Canadian Tire'},
  {id:'WS_JOINT',label:'Wealthsimple Joint'},
  {id:'PC_MC',   label:'PC Mastercard'},
  {id:'CIBC',    label:'CIBC (Ness)'},
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = n => '$' + Math.abs(n).toLocaleString('en-CA',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtK  = n => n>=1000 ? '$'+(n/1000).toFixed(1)+'k' : fmt(n);
const uid   = () => Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const today = () => new Date().toISOString().slice(0,10);

// Derive avatar color from name
function nameColor(name) {
  const n = (name||'').toLowerCase();
  if (n.includes('jordan')) return '#1d4ed8';
  if (n.includes('ness'))   return '#be185d';
  const h = [...n].reduce((a,c)=>a*31+c.charCodeAt(0),0);
  return COLOR_SWATCHES[Math.abs(h) % COLOR_SWATCHES.length];
}
function nameInitials(name) {
  return (name||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,3).toUpperCase();
}

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────
function polarXY(cx,cy,r,deg) {
  const rad = (deg-90)*Math.PI/180;
  return {x:cx+r*Math.cos(rad), y:cy+r*Math.sin(rad)};
}
function arcPath(cx,cy,R,r,start,end) {
  if (end-start >= 360) end = start+359.99;
  const la = end-start > 180 ? 1 : 0;
  const s=polarXY(cx,cy,R,start), e=polarXY(cx,cy,R,end);
  const si=polarXY(cx,cy,r,end),  ei=polarXY(cx,cy,r,start);
  return `M${s.x} ${s.y} A${R} ${R} 0 ${la} 1 ${e.x} ${e.y} L${si.x} ${si.y} A${r} ${r} 0 ${la} 0 ${ei.x} ${ei.y}Z`;
}
function DonutChart({data, total, size=220}) {
  const cx=size/2, cy=size/2, R=size*0.42, ri=size*0.26;
  let angle=0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {data.map(d=>{
        const pct=d.value/total; const sweep=pct*360;
        const path=arcPath(cx,cy,R,ri,angle,angle+sweep);
        angle+=sweep;
        return <path key={d.id} d={path} fill={d.color} opacity={0.9}/>;
      })}
      <text x={cx} y={cy-8} textAnchor="middle" fontFamily={SERIF}
        fontSize={size*0.09} fontWeight="600" fill={C.ink}>
        {fmt(total).replace('.00','')}
      </text>
      <text x={cx} y={cy+14} textAnchor="middle" fontFamily={SANS}
        fontSize={size*0.055} fill={C.inkSoft}>total</text>
    </svg>
  );
}

// ─── Atoms ────────────────────────────────────────────────────────────────────
function CatIcon({name,size=18,color='currentColor'}) {
  const Comp=ICON_MAP[name]||Package;
  return <Comp size={size} color={color} strokeWidth={1.6}/>;
}
function B42Logo({size=48}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <rect width="64" height="64" rx="14" fill={C.green}/>
      <text x="32" y="46" fontFamily={SERIF} fontSize="28" fontWeight="700"
        fill="white" textAnchor="middle" letterSpacing="-1">b42</text>
    </svg>
  );
}
function B42Badge() {
  return (
    <svg width="42" height="26" viewBox="0 0 68 40">
      <rect width="68" height="40" rx="8" fill={C.green}/>
      <text x="34" y="29" fontFamily={SERIF} fontSize="22" fontWeight="700"
        fill="white" textAnchor="middle" letterSpacing="-1">b42</text>
    </svg>
  );
}
function UserAvatar({name,size=28}) {
  const color=nameColor(name), initials=nameInitials(name);
  return <div style={{width:size,height:size,borderRadius:'50%',background:color,color:'#fff',
    display:'flex',alignItems:'center',justifyContent:'center',
    fontSize:size*0.29,fontWeight:600,letterSpacing:'-0.02em',flexShrink:0,fontFamily:SANS}}>
    {initials}</div>;
}
function Bar({spent,target,color}) {
  const pct=Math.min((spent/Math.max(target,1))*100,100);
  return <div style={{height:3,background:C.sandDark,borderRadius:99,overflow:'hidden'}}>
    <div style={{height:'100%',width:`${pct}%`,borderRadius:99,
      background:spent>target?C.red:color,transition:'width 0.4s ease'}}/></div>;
}
function Card({children,style={}}) {
  return <div style={{background:C.white,borderRadius:16,padding:'16px 18px',marginBottom:12,
    boxShadow:'0 1px 4px rgba(0,0,0,0.05),0 0 0 1px rgba(0,0,0,0.04)',...style}}>{children}</div>;
}
function SL({children}) {
  return <p style={{fontSize:11,fontWeight:600,color:C.inkSoft,textTransform:'uppercase',
    letterSpacing:'0.1em',margin:'0 0 8px',fontFamily:SANS}}>{children}</p>;
}
function Divider() { return <div style={{height:1,background:C.sandMid,margin:'2px 0'}}/>; }
function Toast({msg}) {
  return (
    <div style={{position:'fixed',bottom:90,left:0,right:0,zIndex:999,
      display:'flex',justifyContent:'center',pointerEvents:'none',animation:'fadeUp 0.2s ease'}}>
      <div style={{background:C.ink,color:'#fff',padding:'10px 22px',borderRadius:99,
        fontSize:13,fontWeight:500,whiteSpace:'nowrap',
        boxShadow:'0 4px 16px rgba(0,0,0,0.2)',fontFamily:SANS}}>{msg}</div>
    </div>
  );
}
function Spinner({size=16}) {
  return <div style={{width:size,height:size,border:`2px solid ${C.sandDark}`,
    borderTopColor:C.green,borderRadius:'50%',animation:'spin 0.7s linear infinite',
    display:'inline-block',flexShrink:0}}/>;
}

// ─── Processing Modal ─────────────────────────────────────────────────────────
// Shows during CSV upload so users know exactly what's happening and don't close the window
function ProcessingModal({stage, fileName, rowCount, aiCount}) {
  const stages = {
    reading: {
      title: 'Reading your statement',
      msg:   `Opening ${fileName || 'your file'}…`,
      sub:   'This should only take a moment.',
    },
    parsing: {
      title: 'Parsing transactions',
      msg:   `Scanning rows and mapping columns…`,
      sub:   'Identifying dates, amounts, and merchant names.',
    },
    categorising: {
      title: `Categorising ${rowCount || ''} transactions`,
      msg:   'Matching merchants to your budget categories…',
      sub:   'Using 7 months of your spending history as a guide.',
    },
    ai: {
      title: 'Asking Claude to help',
      msg:   `${aiCount || 'Some'} merchants weren't recognised automatically.`,
      sub:   'Claude is categorising them now — this takes 5–15 seconds.',
    },
  };
  const s = stages[stage] || stages.reading;
  return (
    <div style={{position:'fixed',inset:0,zIndex:800,background:'rgba(26,26,24,0.75)',
      display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{background:C.white,borderRadius:20,padding:'32px 28px',maxWidth:340,
        width:'100%',textAlign:'center',boxShadow:'0 24px 48px rgba(0,0,0,0.25)'}}>
        <div style={{marginBottom:20}}>
          <Spinner size={40}/>
        </div>
        <h2 style={{fontFamily:SERIF,fontSize:24,fontWeight:600,color:C.ink,margin:'0 0 8px'}}>
          {s.title}
        </h2>
        <p style={{fontSize:14,color:C.inkMid,margin:'0 0 6px',fontFamily:SANS}}>{s.msg}</p>
        <p style={{fontSize:12,color:C.inkSoft,margin:'0 0 20px',fontFamily:SANS,lineHeight:1.6}}>
          {s.sub}
        </p>
        <div style={{background:C.redLight,border:`1px solid ${C.red}22`,borderRadius:10,
          padding:'10px 14px'}}>
          <p style={{margin:0,fontSize:12,fontWeight:600,color:C.red,fontFamily:SANS}}>
            ⚠ Do not close or refresh this page
          </p>
          <p style={{margin:'4px 0 0',fontSize:11,color:C.red+'99',fontFamily:SANS}}>
            Your data is being processed in the background.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Screen (Sign Up / Sign In) ─────────────────────────────────────────
function AuthScreen({onAuth}) {
  const [mode,     setMode]    = useState('signup'); // 'signup' | 'signin'
  const [name,     setName]    = useState('');
  const [email,    setEmail]   = useState('');
  const [password, setPassword]= useState('');
  const [goal,     setGoal]    = useState('');
  const [showPw,   setShowPw]  = useState(false);
  const [loading,  setLoading] = useState(false);
  const [error,    setError]   = useState(null);
  const [done,     setDone]    = useState(false); // after signup: show "invite partner" screen

  async function handleSignUp(e) {
    e.preventDefault();
    if (!name.trim()||!email.trim()||!password) return;
    setLoading(true); setError(null);
    try {
      await signUp(email.trim(), password, {
        name:  name.trim(),
        role:  name.toLowerCase().includes('jordan') ? 'jordan' :
               name.toLowerCase().includes('ness')   ? 'ness'   : 'other',
        goal:  goal.trim(),
        color: nameColor(name.trim()),
      });
      setDone(true);
    } catch(err) { setError(err.message); }
    setLoading(false);
  }

  async function handleSignIn(e) {
    e.preventDefault();
    if (!email.trim()||!password) return;
    setLoading(true); setError(null);
    try { await signIn(email.trim(), password); }
    catch(err) { setError(err.message); }
    setLoading(false);
  }

  // After first signup: tell them to invite their partner
  if (done) return (
    <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',padding:36,background:C.sand}}>
      <div style={{fontSize:56,marginBottom:12}}>🎉</div>
      <h1 style={{fontFamily:SERIF,fontSize:30,fontWeight:600,margin:'0 0 8px',color:C.ink,letterSpacing:'-0.02em'}}>
        Welcome, {name.split(' ')[0]}!
      </h1>
      <p style={{fontSize:15,color:C.inkMid,margin:'0 0 32px',textAlign:'center',lineHeight:1.7,maxWidth:320}}>
        Your account is set up. Now invite your partner to create their own account so you can track spending together.
      </p>
      <Card style={{width:'100%',maxWidth:340,marginBottom:16}}>
        <p style={{margin:'0 0 8px',fontSize:13,fontWeight:600,color:C.ink,fontFamily:SANS}}>
          Share this with your partner
        </p>
        <div style={{background:C.sand,borderRadius:10,padding:'10px 14px',marginBottom:12,
          fontFamily:'monospace',fontSize:13,color:C.inkMid,wordBreak:'break-all'}}>
          {window.location.origin}
        </div>
        <p style={{margin:0,fontSize:12,color:C.inkSoft,fontFamily:SANS,lineHeight:1.6}}>
          They should open that link and click <b>Create account</b> to sign up with their own name and email.
        </p>
      </Card>
      <button onClick={()=>onAuth()} style={{border:'none',padding:'14px 32px',borderRadius:12,
        background:C.green,color:'#fff',fontSize:15,fontWeight:600,cursor:'pointer',fontFamily:SANS}}>
        Open my budget →
      </button>
    </div>
  );

  return (
    <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',
      alignItems:'center',justifyContent:'center',padding:28,background:C.sand}}>
      <B42Logo size={60}/>
      <h1 style={{fontFamily:SERIF,fontSize:32,fontWeight:600,letterSpacing:'-0.02em',
        margin:'14px 0 4px',color:C.ink}}>Budget For Two</h1>
      <p style={{fontSize:12,color:C.green,fontWeight:600,margin:'0 0 28px',
        letterSpacing:'0.1em',textTransform:'uppercase'}}>Jordan &amp; Ness</p>

      {/* Mode tabs */}
      <div style={{display:'flex',background:C.sandMid,borderRadius:12,padding:3,
        marginBottom:20,width:'100%',maxWidth:340}}>
        {[['signup','Create account'],['signin','Sign in']].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)} style={{flex:1,border:'none',borderRadius:9,
            padding:'9px 0',fontSize:13,fontWeight:600,cursor:'pointer',
            background:mode===k?C.white:'transparent',
            color:mode===k?C.ink:C.inkSoft,
            boxShadow:mode===k?'0 1px 3px rgba(0,0,0,0.1)':'none',
            fontFamily:SANS}}>{l}</button>
        ))}
      </div>

      <form onSubmit={mode==='signup'?handleSignUp:handleSignIn}
        style={{width:'100%',maxWidth:340}}>

        {mode==='signup' && (
          <>
            <p style={{margin:'0 0 10px',fontSize:13,color:C.inkSoft,fontFamily:SANS,
              textAlign:'center',lineHeight:1.6}}>
              Takes 2 minutes. Once both of you are set up,<br/>your budget runs itself.
            </p>
            <input value={name} onChange={e=>setName(e.target.value)}
              placeholder="Your name (e.g. Jordan)"
              style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
                padding:'13px 14px',fontSize:15,color:C.ink,background:C.white,
                marginBottom:10,outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>
          </>
        )}

        <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
          placeholder="Email address" required
          style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
            padding:'13px 14px',fontSize:15,color:C.ink,background:C.white,
            marginBottom:10,outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>

        <div style={{position:'relative',marginBottom:mode==='signup'?10:16}}>
          <input type={showPw?'text':'password'} value={password}
            onChange={e=>setPassword(e.target.value)}
            placeholder="Password" required
            style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
              padding:'13px 44px 13px 14px',fontSize:15,color:C.ink,background:C.white,
              outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>
          <button type="button" onClick={()=>setShowPw(p=>!p)}
            style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',
              border:'none',background:'none',cursor:'pointer',color:C.inkSoft}}>
            {showPw?<EyeOff size={18}/>:<Eye size={18}/>}
          </button>
        </div>

        {mode==='signup' && (
          <div style={{marginBottom:16}}>
            <label style={{display:'block',fontSize:12,color:C.inkSoft,fontFamily:SANS,marginBottom:6}}>
              What is one financial goal you want to achieve this year? (optional)
            </label>
            <input value={goal} onChange={e=>setGoal(e.target.value)}
              placeholder="e.g. Pay off CTFS card by December"
              style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,
                padding:'13px 14px',fontSize:14,color:C.ink,background:C.white,
                outline:'none',fontFamily:SANS,boxSizing:'border-box'}}/>
          </div>
        )}

        {error && (
          <div style={{background:C.redLight,border:`1px solid ${C.red}33`,borderRadius:10,
            padding:'10px 14px',marginBottom:12,display:'flex',gap:8,alignItems:'center'}}>
            <AlertCircle size={14} color={C.red}/>
            <p style={{margin:0,fontSize:13,color:C.red,fontFamily:SANS}}>{error}</p>
          </div>
        )}

        <button type="submit" disabled={loading}
          style={{width:'100%',border:'none',padding:'15px',borderRadius:12,
            background:C.green,color:'#fff',fontSize:15,fontWeight:600,cursor:'pointer',
            fontFamily:SANS,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
          {loading?<><Spinner/>Processing…</>:mode==='signup'?'Create my account →':'Sign in →'}
        </button>
      </form>

      {mode==='signup' && (
        <p style={{fontSize:11,color:C.inkSoft,marginTop:20,textAlign:'center',
          maxWidth:280,lineHeight:1.7,fontFamily:SANS}}>
          Your data is stored securely in Supabase.<br/>
          Both partners create separate accounts that share the same budget.
        </p>
      )}
    </div>
  );
}

// ─── Add Category Modal ───────────────────────────────────────────────────────
function AddCatModal({onSave,onClose}) {
  const [label, setLabel] = useState('');
  const [target,setTarget]= useState(100);
  const [icon,  setIcon]  = useState('Tag');
  const [color, setColor] = useState(COLOR_SWATCHES[0]);
  return (
    <div style={{position:'fixed',inset:0,zIndex:500,display:'flex',flexDirection:'column',justifyContent:'flex-end'}}>
      <div onClick={onClose} style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.4)'}}/>
      <div style={{position:'relative',background:C.white,borderRadius:'20px 20px 0 0',
        padding:'24px 20px 40px',animation:'slideUp 0.25s ease',maxHeight:'85dvh',overflowY:'auto'}}>
        <div style={{display:'flex',alignItems:'center',marginBottom:20}}>
          <h2 style={{flex:1,fontFamily:SERIF,fontSize:22,fontWeight:600,color:C.ink}}>New category</h2>
          <button onClick={onClose} style={{border:'none',background:'none',padding:4,cursor:'pointer'}}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>
        <SL>Name</SL>
        <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. Pet supplies"
          style={{width:'100%',border:`1px solid ${C.sandDark}`,borderRadius:10,padding:'12px 14px',
            fontSize:16,color:C.ink,background:C.sand,marginBottom:16,outline:'none',
            fontFamily:SANS,boxSizing:'border-box'}}/>
        <SL>Monthly target</SL>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16}}>
          <span style={{fontSize:18,color:C.inkSoft}}>$</span>
          <input type="number" value={target} onChange={e=>setTarget(parseInt(e.target.value)||0)}
            style={{flex:1,border:`1px solid ${C.sandDark}`,borderRadius:10,padding:'12px 14px',
              fontSize:16,color:C.ink,background:C.sand,outline:'none',fontFamily:SANS}}/>
        </div>
        <SL>Icon</SL>
        <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:8,marginBottom:16}}>
          {PICKABLE_ICONS.map(k=>(
            <button key={k} onClick={()=>setIcon(k)} style={{border:`2px solid ${icon===k?color:C.sandDark}`,
              borderRadius:10,padding:'8px 0',display:'flex',alignItems:'center',justifyContent:'center',
              background:icon===k?color+'18':C.white,cursor:'pointer'}}>
              <CatIcon name={k} size={16} color={icon===k?color:C.inkSoft}/>
            </button>
          ))}
        </div>
        <SL>Colour</SL>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:24}}>
          {COLOR_SWATCHES.map(sw=>(
            <button key={sw} onClick={()=>setColor(sw)} style={{width:30,height:30,borderRadius:'50%',
              background:sw,border:`3px solid ${color===sw?C.ink:'transparent'}`,cursor:'pointer'}}/>
          ))}
        </div>
        <button onClick={()=>{if(label.trim())onSave({id:'custom_'+uid(),label:label.trim(),target,icon,color,custom:true});}}
          disabled={!label.trim()}
          style={{border:'none',width:'100%',padding:'15px',borderRadius:12,
            background:label.trim()?C.green:C.sandDark,color:label.trim()?C.white:C.inkSoft,
            fontSize:16,fontWeight:600,cursor:label.trim()?'pointer':'default',fontFamily:SANS}}>
          Add category
        </button>
      </div>
    </div>
  );
}


// ─── OtherReviewModal ─────────────────────────────────────────────────────────
// Shows all transactions still in "Other" so the user can re-categorise them.
// Each row has: description, date, amount, category dropdown, note field, AI button.
function OtherReviewModal({ items, allCats, onSave, onClose }) {
  // Local edits: { id: { category, note } }
  const [edits,   setEdits]   = useState(() =>
    Object.fromEntries(items.map(t => [t.id, { category: t.category || 'other', note: t.note || '' }]))
  );
  const [aiStatus, setAiStatus] = useState({}); // { id: 'loading' | { category, reason } | 'error' }
  const [saving,   setSaving]   = useState(false);

  function edit(id, patch) {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function askAI(tx) {
    if (!AI_AVAILABLE) return;
    setAiStatus(prev => ({ ...prev, [tx.id]: 'loading' }));
    const catIds = allCats.map(c => c.id);
    const result = await suggestCategory(tx.description, tx.amount, catIds);
    if (result?.category) {
      setAiStatus(prev => ({ ...prev, [tx.id]: result }));
    } else {
      setAiStatus(prev => ({ ...prev, [tx.id]: 'error' }));
    }
  }

  function acceptAI(id) {
    const sug = aiStatus[id];
    if (sug && sug !== 'loading' && sug !== 'error') {
      edit(id, { category: sug.category });
    }
  }

  async function saveAll() {
    setSaving(true);
    try {
      await Promise.all(
        items.map(tx =>
          updateBankImport(tx.id, {
            category: edits[tx.id]?.category || tx.category,
            note:     edits[tx.id]?.note     || tx.note || '',
          })
        )
      );
      onSave();
    } catch (err) {
      console.error('Save failed:', err);
    }
    setSaving(false);
  }

  const changed = items.filter(tx =>
    edits[tx.id]?.category !== (tx.category || 'other') ||
    (edits[tx.id]?.note || '') !== (tx.note || '')
  ).length;

  return (
    <div style={{ position:'fixed', inset:0, zIndex:600,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      {/* Backdrop */}
      <div onClick={onClose}
        style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>

      {/* Sheet */}
      <div style={{ position:'relative', background:C.sand, borderRadius:'20px 20px 0 0',
        maxHeight:'92dvh', display:'flex', flexDirection:'column',
        animation:'slideUp 0.25s ease', boxShadow:'0 -8px 32px rgba(0,0,0,0.2)' }}>

        {/* Header */}
        <div style={{ padding:'20px 20px 14px', borderBottom:`1px solid ${C.sandMid}`,
          flexShrink:0, background:C.white, borderRadius:'20px 20px 0 0' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:6 }}>
            <div style={{ flex:1 }}>
              <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
                Review uncategorised transactions
              </h2>
              <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
                {items.length} {items.length === 1 ? 'item' : 'items'} landed in "Other".
                Assign each to the right category and add a note so you know what it was.
              </p>
            </div>
            <button onClick={onClose}
              style={{ border:'none', background:'none', padding:6, cursor:'pointer', flexShrink:0 }}>
              <X size={22} color={C.inkSoft}/>
            </button>
          </div>
          {AI_AVAILABLE && (
            <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:10,
              padding:'8px 12px', display:'flex', gap:8, alignItems:'center' }}>
              <Sparkles size={13} color={C.purple}/>
              <p style={{ margin:0, fontSize:12, color:'#5b21b6', fontFamily:SANS }}>
                Tap <b>Ask AI</b> on any row for an instant category suggestion.
              </p>
            </div>
          )}
        </div>

        {/* Scrollable list */}
        <div style={{ overflowY:'auto', flex:1, padding:'12px 16px' }}>
          {items.map((tx, i) => {
            const catVal  = edits[tx.id]?.category || 'other';
            const noteVal = edits[tx.id]?.note || '';
            const cat     = allCats.find(c => c.id === catVal) || { color:C.inkSoft, icon:'Package' };
            const ai      = aiStatus[tx.id];
            const isOther = catVal === 'other';

            return (
              <div key={tx.id} style={{ background:C.white, borderRadius:14,
                padding:'14px 16px', marginBottom:10,
                boxShadow:'0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
                border: isOther ? `1.5px solid ${C.amber}55` : `1.5px solid ${C.green}33` }}>

                {/* Top row: description + amount */}
                <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:cat.color+'18',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <CatIcon name={cat.icon} size={18} color={cat.color}/>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.ink,
                      fontFamily:SANS, lineHeight:1.3 }}>{tx.description}</p>
                    <p style={{ margin:'3px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                      {tx.date} · {tx.source}
                    </p>
                  </div>
                  <p style={{ margin:0, fontFamily:SERIF, fontSize:18, fontWeight:700,
                    color:C.ink, flexShrink:0 }}>{fmt(tx.amount)}</p>
                </div>

                {/* Category selector */}
                <div style={{ marginBottom:8 }}>
                  <label style={{ fontSize:11, color:C.inkSoft, textTransform:'uppercase',
                    letterSpacing:'0.08em', fontFamily:SANS, display:'block', marginBottom:4 }}>
                    Category {isOther && <span style={{ color:C.amber }}>— needs review</span>}
                  </label>
                  <select value={catVal}
                    onChange={e => edit(tx.id, { category: e.target.value })}
                    style={{ width:'100%', border:`1.5px solid ${isOther?C.amber:cat.color}`,
                      borderRadius:9, padding:'8px 10px', fontSize:13, fontWeight:600,
                      color:isOther?C.amber:cat.color, background:C.white,
                      fontFamily:SANS, cursor:'pointer', outline:'none' }}>
                    {allCats.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>

                {/* AI suggestion pill */}
                {AI_AVAILABLE && (
                  <div style={{ marginBottom:8 }}>
                    {!ai && (
                      <button onClick={() => askAI(tx)}
                        style={{ border:`1px solid ${C.purple}`, borderRadius:8, padding:'5px 12px',
                          background:'#f5f3ff', color:C.purple, fontSize:12, fontWeight:600,
                          cursor:'pointer', fontFamily:SANS,
                          display:'flex', alignItems:'center', gap:5 }}>
                        <Sparkles size={12} color={C.purple}/>
                        Ask AI to suggest a category
                      </button>
                    )}
                    {ai === 'loading' && (
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'5px 0' }}>
                        <Spinner size={13}/>
                        <span style={{ fontSize:12, color:C.inkSoft, fontFamily:SANS }}>
                          Claude is thinking…
                        </span>
                      </div>
                    )}
                    {ai === 'error' && (
                      <p style={{ margin:0, fontSize:12, color:C.red, fontFamily:SANS }}>
                        AI couldn't categorise this one. Try picking manually.
                      </p>
                    )}
                    {ai && ai !== 'loading' && ai !== 'error' && (
                      <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd',
                        borderRadius:9, padding:'8px 12px' }}>
                        <p style={{ margin:'0 0 4px', fontSize:12, color:'#5b21b6',
                          fontFamily:SANS, fontWeight:600 }}>
                          AI suggests:&nbsp;
                          <span style={{ color:allCats.find(c=>c.id===ai.category)?.color||C.ink }}>
                            {allCats.find(c=>c.id===ai.category)?.label || ai.category}
                          </span>
                        </p>
                        <p style={{ margin:'0 0 8px', fontSize:11, color:'#7c3aed', fontFamily:SANS }}>
                          {ai.reason}
                        </p>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={() => acceptAI(tx.id)}
                            style={{ border:'none', borderRadius:7, padding:'5px 12px',
                              background:C.green, color:'#fff', fontSize:12,
                              fontWeight:600, cursor:'pointer', fontFamily:SANS }}>
                            Accept
                          </button>
                          <button onClick={() => setAiStatus(prev => ({ ...prev, [tx.id]: null }))}
                            style={{ border:`1px solid ${C.sandDark}`, borderRadius:7,
                              padding:'5px 10px', background:'#fff', fontSize:12,
                              color:C.inkSoft, cursor:'pointer', fontFamily:SANS }}>
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Note field */}
                <div>
                  <label style={{ fontSize:11, color:C.inkSoft, textTransform:'uppercase',
                    letterSpacing:'0.08em', fontFamily:SANS, display:'block', marginBottom:4 }}>
                    Your note (what was this?)
                  </label>
                  <input
                    type="text"
                    value={noteVal}
                    onChange={e => edit(tx.id, { note: e.target.value })}
                    placeholder={`e.g. "Groceries at No Frills" or "Birthday dinner"`}
                    style={{ width:'100%', border:`1px solid ${C.sandDark}`, borderRadius:9,
                      padding:'8px 12px', fontSize:13, color:C.ink, background:C.sand,
                      fontFamily:SANS, outline:'none', boxSizing:'border-box',
                      caretColor:C.green }}
                  />
                </div>
              </div>
            );
          })}
          <div style={{ height:20 }}/>
        </div>

        {/* Save footer */}
        <div style={{ padding:'12px 16px 24px', borderTop:`1px solid ${C.sandMid}`,
          background:C.white, flexShrink:0 }}>
          <button onClick={saveAll} disabled={saving}
            style={{ width:'100%', border:'none', padding:'15px', borderRadius:14,
              background:C.green, color:'#fff', fontSize:15, fontWeight:700,
              cursor:'pointer', fontFamily:SANS,
              display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {saving ? <><Spinner/>Saving…</> :
              changed > 0
                ? `Save ${changed} change${changed > 1 ? 's' : ''}`
                : 'Done — close'}
          </button>
          <p style={{ margin:'8px 0 0', fontSize:11, color:C.inkSoft,
            textAlign:'center', fontFamily:SANS }}>
            Items you leave as "Other" can be reviewed again from the Home tab.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────
function HomeTab({txns,bankImports,income,ccTarget,setIncome,setCcTarget,
                  allCats,onSaveSettings,catTargets,suggested,onAcceptSuggested,
                  onAddCat,onDeleteCat,profile,onReviewOther,otherCount}) {
  const totalIncome=Object.values(income).reduce((a,b)=>a+b,0);
  const totalFixed=FIXED.reduce((a,b)=>a+b.amount,0);
  const totalSubs=SUBS.reduce((a,b)=>a+b.amount,0);
  const committed=totalFixed+totalSubs+ccTarget;
  const allTx=[...txns,...bankImports];
  const txByCat={};
  allTx.forEach(t=>{const k=t.category||t.cat;if(k&&k!=='_skip')txByCat[k]=(txByCat[k]||0)+t.amount;});
  const totalSpent=Object.values(txByCat).reduce((a,b)=>a+b,0);
  const surplus=totalIncome-committed-totalSpent;
  const [showAdd,setShowAdd]=useState(false);

  // Show the user's financial goal prominently if set
  const goal=profile?.goal;

  return (
    <div style={{padding:'16px 16px 0'}}>
      {/* Hero */}
      <Card style={{background:C.green,padding:'20px 20px'}}>
        <p style={{fontSize:11,color:'rgba(255,255,255,0.7)',textTransform:'uppercase',
          letterSpacing:'0.1em',margin:'0 0 4px',fontFamily:SANS}}>Available this month</p>
        <p style={{fontFamily:SERIF,fontSize:44,fontWeight:600,color:'#fff',margin:'0 0 16px',
          letterSpacing:'-0.02em',lineHeight:1}}>
          {surplus>=0?fmt(surplus):'–'+fmt(Math.abs(surplus))}
        </p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          {[['Income',fmt(totalIncome)],['Committed',fmt(committed)],['Spent',fmt(totalSpent)]].map(([l,v])=>(
            <div key={l}>
              <p style={{margin:0,fontSize:11,color:'rgba(255,255,255,0.65)',
                textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>{l}</p>
              <p style={{margin:0,fontFamily:SERIF,fontSize:18,fontWeight:600,
                color:'rgba(255,255,255,0.95)'}}>{v}</p>
            </div>
          ))}
        </div>
        {goal&&<p style={{margin:'14px 0 0',fontSize:12,color:'rgba(255,255,255,0.8)',
          fontFamily:SANS,borderTop:'1px solid rgba(255,255,255,0.2)',paddingTop:10}}>
          🎯 Goal: {goal}
        </p>}
      </Card>

      {/* CTFS */}
      <div style={{background:C.redLight,border:`1px solid ${C.red}22`,borderRadius:14,
        padding:'12px 16px',marginBottom:12,display:'flex',gap:10,alignItems:'center'}}>
        <div style={{flex:1}}>
          <p style={{margin:'0 0 2px',fontSize:13,fontWeight:600,color:C.red,fontFamily:SANS}}>
            CTFS debt — $18,933 at 22% APR
          </p>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:12,color:'#9b2c2c',fontFamily:SANS}}>Payment target: $</span>
            <input type="number" value={ccTarget}
              onChange={e=>{const v=parseFloat(e.target.value)||0;setCcTarget(v);onSaveSettings(income,v);}}
              style={{width:68,border:`1px solid ${C.red}44`,borderRadius:7,padding:'3px 7px',
                fontSize:13,fontWeight:600,color:C.red,background:'#fff',fontFamily:SANS}}/>
          </div>
        </div>
      </div>

      {/* Suggested targets */}
      {Object.keys(suggested||{}).length>0&&(
        <div style={{background:C.greenLight,border:`1px solid ${C.green}33`,borderRadius:14,
          padding:'12px 16px',marginBottom:12}}>
          <p style={{margin:'0 0 6px',fontSize:13,fontWeight:600,color:C.green,fontFamily:SANS}}>
            <Sparkles size={14} style={{marginRight:6,verticalAlign:'middle'}}/>
            Budget targets updated from your statements
          </p>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
            {Object.entries(suggested).map(([catId,val])=>{
              const c=allCats.find(x=>x.id===catId);if(!c)return null;
              const old=catTargets[catId]||c.target;
              return <span key={catId} style={{background:C.white,borderRadius:7,padding:'3px 10px',
                fontSize:12,fontWeight:500,color:C.green,border:`1px solid ${C.green}44`}}>
                {c.label}: ${old}→<b>${val}</b></span>;
            })}
          </div>
          <button onClick={onAcceptSuggested} style={{border:'none',borderRadius:8,padding:'7px 14px',
            background:C.green,color:'#fff',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:SANS}}>
            Apply all
          </button>
        </div>
      )}

      {/* Other category alert — shown when imported transactions need review */}
      {otherCount > 0 && (
        <button onClick={onReviewOther} style={{ width:'100%', border:`1.5px solid ${C.amber}`,
          borderRadius:14, padding:'12px 16px', marginBottom:12, background:'#fffbeb',
          cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:C.amber+'22',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <AlertCircle size={18} color={C.amber}/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.amber, fontFamily:SANS }}>
              {otherCount} transaction{otherCount>1?'s':''} need{otherCount===1?'s':''} categorising
            </p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#92400e', fontFamily:SANS }}>
              These are in "Other" and may be skewing your budget. Tap to review.
            </p>
          </div>
          <ChevronRight size={18} color={C.amber}/>
        </button>
      )}

      <SL>Spending this month</SL>
      <Card style={{padding:'8px 0'}}>
        {allCats.map((cat,i)=>{
          const spent=txByCat[cat.id]||0;
          const target=catTargets[cat.id]||cat.target;
          const over=spent>target;
          return (
            <div key={cat.id}>
              {i>0&&<Divider/>}
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'11px 18px'}}>
                <div style={{width:32,height:32,borderRadius:9,background:cat.color+'18',
                  display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <CatIcon name={cat.icon} size={16} color={cat.color}/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:14,color:C.ink,fontFamily:SANS,fontWeight:spent>0?500:400}}>{cat.label}</span>
                    <div style={{display:'flex',alignItems:'baseline',gap:4}}>
                      <span style={{fontFamily:SERIF,fontSize:17,fontWeight:600,
                        color:over?C.red:spent>0?C.ink:C.sandDark}}>{fmt(spent)}</span>
                      <span style={{fontSize:11,color:C.inkSoft,fontFamily:SANS}}>{fmtK(target)}</span>
                    </div>
                  </div>
                  <Bar spent={spent} target={target} color={cat.color}/>
                  {over&&<p style={{margin:'3px 0 0',fontSize:10,color:C.red,fontFamily:SANS}}>
                    {fmt(spent-target)} over</p>}
                </div>
                {cat.custom&&(
                  <button onClick={()=>{if(window.confirm(`Remove "${cat.label}"?`))onDeleteCat(cat.id);}}
                    style={{border:'none',background:'none',padding:4,cursor:'pointer',flexShrink:0}}>
                    <X size={14} color={C.inkSoft}/>
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <Divider/>
        <button onClick={()=>setShowAdd(true)} style={{display:'flex',alignItems:'center',gap:10,
          padding:'12px 18px',width:'100%',border:'none',background:'none',cursor:'pointer'}}>
          <div style={{width:32,height:32,borderRadius:9,background:C.sandMid,
            display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Plus size={16} color={C.inkSoft}/>
          </div>
          <span style={{fontSize:14,color:C.inkSoft,fontFamily:SANS}}>Add category</span>
        </button>
      </Card>

      <SL>Income this month</SL>
      <Card style={{padding:'8px 0'}}>
        {[['jordan','Jordan — NORR salary (est.)'],['ness','Ness — contribution'],['sunlife','SunLife reimbursement']].map(([k,l],i)=>(
          <div key={k}>
            {i>0&&<Divider/>}
            <div style={{display:'flex',alignItems:'center',gap:12,padding:'11px 18px'}}>
              {k!=='sunlife'?<div style={{width:30,height:30,borderRadius:'50%',
                  background:k==='jordan'?'#1d4ed8':'#be185d',color:'#fff',
                  display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:600}}>
                  {k==='jordan'?'JY':'NMK'}</div>:
                <div style={{width:30,height:30,borderRadius:'50%',background:C.greenLight,
                  display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <Leaf size={14} color={C.green}/>
                </div>}
              <span style={{flex:1,fontSize:14,color:C.ink,fontFamily:SANS}}>{l}</span>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:14,color:C.green,fontFamily:SERIF}}>$</span>
                <input type="number" value={income[k]}
                  onChange={e=>{const n={...income,[k]:parseFloat(e.target.value)||0};setIncome(n);onSaveSettings(n,ccTarget);}}
                  style={{width:90,border:`1px solid ${C.sandDark}`,borderRadius:8,padding:'5px 8px',
                    fontSize:14,fontWeight:600,color:C.ink,textAlign:'right',
                    background:C.sand,fontFamily:SERIF,outline:'none'}}/>
              </div>
            </div>
          </div>
        ))}
      </Card>
      {showAdd&&<AddCatModal onSave={cat=>{onAddCat(cat);setShowAdd(false);}} onClose={()=>setShowAdd(false)}/>}
    </div>
  );
}

// ─── ADD TAB ──────────────────────────────────────────────────────────────────
function AddTab({profile,allCats,onAdd}) {
  const [cat,   setCat]   = useState(null);
  const [amount,setAmount]= useState('');
  const [note,  setNote]  = useState('');
  const [date,  setDate]  = useState(today());
  const [saving,setSaving]= useState(false);
  const ref=useRef(null);
  useEffect(()=>{ref.current?.focus();},[]);
  const can=cat&&parseFloat(amount)>0;
  const selCat=allCats.find(c=>c.id===cat);
  async function submit() {
    if(!can||saving)return;
    setSaving(true);
    await onAdd({cat,amount:parseFloat(amount),note:note.trim(),date,who:profile?.name||'unknown'});
    setCat(null);setAmount('');setNote('');setDate(today());
    setSaving(false);ref.current?.focus();
  }
  return (
    <div style={{padding:'16px 16px 0'}}>
      <Card style={{textAlign:'center',padding:'24px 16px'}}>
        <p style={{margin:'0 0 8px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
          letterSpacing:'0.1em',fontFamily:SANS}}>Amount</p>
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:4}}>
          <span style={{fontFamily:SERIF,fontSize:36,fontWeight:400,color:C.sandDark,lineHeight:1}}>$</span>
          <input ref={ref} type="number" inputMode="decimal" placeholder="0.00" value={amount}
            onChange={e=>setAmount(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{fontFamily:SERIF,fontSize:56,fontWeight:600,color:C.ink,border:'none',
              outline:'none',background:'none',width:200,textAlign:'center',
              letterSpacing:'-0.03em',lineHeight:1}}/>
        </div>
        {can&&<p style={{margin:'8px 0 0',fontSize:13,color:C.inkSoft,fontFamily:SANS}}>
          {selCat?.label} · {fmt(parseFloat(amount))}</p>}
      </Card>
      <SL>Category</SL>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:16}}>
        {allCats.map(c=>(
          <button key={c.id} onClick={()=>setCat(c.id)} style={{
            border:`1.5px solid ${cat===c.id?c.color:C.sandDark}`,borderRadius:12,
            padding:'10px 8px 8px',display:'flex',flexDirection:'column',alignItems:'center',gap:6,
            background:cat===c.id?c.color+'15':C.white,cursor:'pointer',transition:'all 0.12s'}}>
            <CatIcon name={c.icon} size={20} color={cat===c.id?c.color:C.inkSoft}/>
            <span style={{fontSize:11,fontWeight:cat===c.id?600:400,
              color:cat===c.id?c.color:C.inkMid,textAlign:'center',lineHeight:1.2,fontFamily:SANS}}>
              {c.label}</span>
          </button>
        ))}
      </div>
      <Card style={{padding:0}}>
        <div style={{padding:'14px 18px'}}>
          <input type="text" placeholder="Note (optional)" value={note}
            onChange={e=>setNote(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()}
            style={{width:'100%',border:'none',outline:'none',fontSize:16,color:C.ink,
              background:'none',fontFamily:SANS,caretColor:C.green}}/>
        </div>
        <Divider/>
        <div style={{padding:'12px 18px',display:'flex',gap:12,alignItems:'center'}}>
          <div style={{flex:1}}>
            <p style={{margin:'0 0 3px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
              letterSpacing:'0.08em',fontFamily:SANS}}>Date</p>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)}
              style={{border:'none',outline:'none',fontSize:14,color:C.ink,background:'none',fontFamily:SANS}}/>
          </div>
          <div>
            <p style={{margin:'0 0 4px',fontSize:11,color:C.inkSoft,fontFamily:SANS}}>Logged by</p>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <UserAvatar name={profile?.name||'?'} size={28}/>
              <span style={{fontSize:13,fontWeight:600,color:C.inkMid,fontFamily:SANS}}>
                {profile?.name||'You'}
              </span>
            </div>
          </div>
        </div>
      </Card>
      <button onClick={submit} disabled={!can||saving} style={{border:'none',width:'100%',
        padding:'16px',borderRadius:14,fontSize:16,fontWeight:600,cursor:can?'pointer':'default',
        background:can?C.green:C.sandDark,color:can?'#fff':C.inkSoft,fontFamily:SANS,
        display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginBottom:8}}>
        {saving?<><Spinner/>Saving…</>:can?`Add ${fmt(parseFloat(amount))} to ${selCat?.label}`:'Select a category and enter amount'}
      </button>
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────────────────────
function HistoryTab({txns,bankImports,allCats,onDeleteTxn,onDeleteImport,onSaveNote}) {
  const [filter,   setFilter]   = useState('all');
  const [srcFil,   setSrcFil]   = useState('all');
  const [editNote, setEditNote] = useState(null); // { id, type, value }
  const all=[
    ...txns.map(t=>({...t,_type:'manual'})),
    ...bankImports.map(t=>({...t,_type:'import'})),
  ]
    .filter(t=>filter==='all'||t.who===filter||(t.who||'').toLowerCase().includes(filter))
    .filter(t=>srcFil==='all'||(srcFil==='manual'&&t._type==='manual')||(srcFil==='import'&&t._type==='import'))
    .sort((a,b)=>new Date(b.date)-new Date(a.date));
  const grouped={};
  all.forEach(t=>{
    const label=new Date(t.date+'T00:00:00').toLocaleDateString('en-CA',{weekday:'short',month:'short',day:'numeric'});
    if(!grouped[label])grouped[label]=[];
    grouped[label].push(t);
  });
  const total=all.reduce((a,t)=>a+t.amount,0);
  return (
    <div style={{padding:'16px 16px 0'}}>
      <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap'}}>
        {[['all','Everyone'],['jordan','Jordan'],['ness','Ness']].map(([k,l])=>(
          <button key={k} onClick={()=>setFilter(k)} style={{border:'none',padding:'6px 14px',
            borderRadius:99,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:SANS,
            background:filter===k?C.ink:'transparent',color:filter===k?'#fff':C.inkSoft,
            outline:filter===k?'none':`1px solid ${C.sandDark}`}}>{l}</button>
        ))}
        {[['all','All'],['manual','Manual'],['import','Imported']].map(([k,l])=>(
          <button key={k} onClick={()=>setSrcFil(k)} style={{border:'none',padding:'6px 14px',
            borderRadius:99,fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:SANS,
            background:srcFil===k?C.purple:'transparent',color:srcFil===k?'#fff':C.inkSoft,
            outline:srcFil===k?'none':`1px solid ${C.sandDark}`}}>{l}</button>
        ))}
      </div>
      {all.length>0&&<p style={{textAlign:'right',fontSize:12,color:C.inkSoft,margin:'0 0 8px',fontFamily:SANS}}>
        {all.length} entries · <span style={{fontFamily:SERIF,fontWeight:600,fontSize:14,color:C.ink}}>{fmt(total)}</span>
      </p>}
      {all.length===0?(
        <div style={{textAlign:'center',padding:'60px 0',color:C.inkSoft}}>
          <Package size={40} color={C.sandDark} style={{marginBottom:12}}/>
          <p style={{fontFamily:SERIF,fontSize:20,color:C.inkMid}}>No transactions yet</p>
        </div>
      ):Object.entries(grouped).map(([day,items])=>(
        <div key={day}>
          <p style={{margin:'0 0 6px',fontSize:11,color:C.inkSoft,fontWeight:600,
            textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>{day}</p>
          <Card style={{padding:'4px 0',marginBottom:10}}>
            {items.map((tx,i)=>{
              const catId=tx.cat||tx.category;
              const c=allCats.find(x=>x.id===catId)||{icon:'Package',color:C.inkSoft,label:'Other'};
              return (
                <div key={tx.id}>
                  {i>0&&<Divider/>}
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 16px'}}>
                    <div style={{width:34,height:34,borderRadius:10,background:c.color+'18',
                      display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <CatIcon name={c.icon} size={16} color={c.color}/>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{margin:0,fontSize:14,fontWeight:500,color:C.ink,fontFamily:SANS,
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {tx.note||tx.description||c.label}</p>
                      {/* Editable note field */}
                      {editNote?.id===tx.id ? (
                        <div style={{display:'flex',gap:6,marginTop:4}} onClick={e=>e.stopPropagation()}>
                          <input
                            autoFocus
                            type="text"
                            value={editNote.value}
                            onChange={e=>setEditNote(prev=>({...prev,value:e.target.value}))}
                            onKeyDown={e=>{
                              if(e.key==='Enter'){onSaveNote(tx.id,tx._type,editNote.value);setEditNote(null);}
                              if(e.key==='Escape')setEditNote(null);
                            }}
                            placeholder="What was this transaction?"
                            style={{flex:1,border:`1px solid ${C.green}`,borderRadius:7,padding:'4px 8px',
                              fontSize:12,color:C.ink,background:C.sand,fontFamily:SANS,outline:'none'}}
                          />
                          <button onClick={()=>{onSaveNote(tx.id,tx._type,editNote.value);setEditNote(null);}}
                            style={{border:'none',background:C.green,color:'#fff',borderRadius:7,
                              padding:'4px 8px',fontSize:12,cursor:'pointer',fontFamily:SANS}}>
                            Save
                          </button>
                        </div>
                      ) : (
                        <button onClick={()=>setEditNote({id:tx.id,type:tx._type,value:tx.note||''})}
                          style={{border:'none',background:'none',padding:0,cursor:'pointer',
                            textAlign:'left',width:'100%',marginTop:2}}>
                          <p style={{margin:0,fontSize:11,fontFamily:SANS,
                            color:tx.note?C.green:C.inkSoft+'88',fontStyle:tx.note?'normal':'italic'}}>
                            {tx.note
                              ? tx.note
                              : (tx._type==='import'
                                  ? `${tx.source} import · tap to add note`
                                  : `${c.label} · tap to add note`)}
                            {tx.who?' · '+tx.who:''}
                          </p>
                        </button>
                      )}
                    </div>
                    <UserAvatar name={tx.who||'?'} size={22}/>
                    <p style={{margin:0,fontFamily:SERIF,fontSize:17,fontWeight:600,color:C.ink,
                      fontVariantNumeric:'tabular-nums',minWidth:64,textAlign:'right'}}>{fmt(tx.amount)}</p>
                    <button onClick={()=>{if(window.confirm('Remove?'))
                        tx._type==='import'?onDeleteImport(tx.id):onDeleteTxn(tx.id);}}
                      style={{border:'none',background:'none',cursor:'pointer',padding:'4px',flexShrink:0}}>
                      <Trash2 size={14} color={C.sandDark}/>
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      ))}
    </div>
  );
}

// ─── BILLS TAB ────────────────────────────────────────────────────────────────
function BillsTab() {
  const tc={bill:C.blue,sub:C.purple,medical:C.red,debt:C.red};
  const tl={bill:'Bill',sub:'Sub',medical:'Medical',debt:'⚠ Debt'};
  return (
    <div style={{padding:'16px 16px 0'}}>
      <SL>Upcoming — next 30 days</SL>
      <Card style={{padding:'4px 0'}}>
        {UPCOMING.map((item,i)=>(
          <div key={i}>
            {i>0&&<Divider/>}
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 18px',
              background:item.crit?C.redLight:C.white}}>
              <div style={{flex:1}}>
                <p style={{margin:0,fontSize:14,fontWeight:item.crit?600:500,
                  color:item.crit?C.red:C.ink,fontFamily:SANS}}>{item.label}</p>
                <p style={{margin:'2px 0 0',fontSize:12,color:item.crit?C.red+'99':C.inkSoft,fontFamily:SANS}}>{item.date}</p>
              </div>
              <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:99,
                background:(tc[item.type]||C.inkSoft)+'18',color:tc[item.type]||C.inkSoft,
                fontFamily:SANS}}>{tl[item.type]||item.type}</span>
              <p style={{margin:0,fontFamily:SERIF,fontSize:16,fontWeight:600,
                color:item.crit?C.red:C.ink}}>{fmt(item.amount)}</p>
            </div>
          </div>
        ))}
      </Card>
      <SL>Monthly fixed — {fmt(FIXED.reduce((a,b)=>a+b.amount,0))}/mo</SL>
      <Card style={{padding:'4px 0'}}>
        {FIXED.map((f,i)=>(
          <div key={i}>{i>0&&<Divider/>}
            <div style={{display:'flex',padding:'11px 18px'}}>
              <span style={{flex:1,fontSize:14,color:C.ink,fontFamily:SANS}}>{f.label}</span>
              <span style={{fontSize:12,color:C.inkSoft,marginRight:12,fontFamily:SANS}}>{f.due}</span>
              <span style={{fontFamily:SERIF,fontSize:16,fontWeight:600,color:C.ink}}>{fmt(f.amount)}</span>
            </div>
          </div>
        ))}
      </Card>
      <SL>Subscriptions — {fmt(SUBS.reduce((a,b)=>a+b.amount,0))}/mo</SL>
      <Card style={{padding:'4px 0'}}>
        {SUBS.map((s,i)=>(
          <div key={i}>{i>0&&<Divider/>}
            <div style={{display:'flex',padding:'11px 18px'}}>
              <span style={{flex:1,fontSize:14,color:C.ink,fontFamily:SANS}}>{s.label}</span>
              <span style={{fontSize:12,color:C.inkSoft,marginRight:12,fontFamily:SANS}}>{s.due}</span>
              <span style={{fontFamily:SERIF,fontSize:16,fontWeight:600,color:C.ink}}>{fmt(s.amount)}</span>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── CHARTS TAB ───────────────────────────────────────────────────────────────
function ChartsTab({txns,bankImports,allCats,year,month}) {
  const [view,setView]=useState('month'); // 'month' | 'year'
  const [annualData,setAnnualData]=useState([]);
  const [annualLoaded,setAnnualLoaded]=useState(false);

  useEffect(()=>{
    getAllBankImports().then(data=>{setAnnualData(data);setAnnualLoaded(true);}).catch(()=>{setAnnualLoaded(true);});
  },[]);

  // Monthly data
  const allTx=[...txns,...bankImports];
  const monthly={};
  allTx.forEach(t=>{const k=t.category||t.cat;if(k&&k!=='_skip')monthly[k]=(monthly[k]||0)+t.amount;});
  const monthlyTotal=Object.values(monthly).reduce((a,b)=>a+b,0);
  const monthlySlices=allCats
    .map(c=>({id:c.id,label:c.label,color:c.color,value:monthly[c.id]||0}))
    .filter(d=>d.value>0)
    .sort((a,b)=>b.value-a.value);

  // Annual data
  const annual={};
  annualData.forEach(({category,amount})=>{if(category&&category!=='_skip')annual[category]=(annual[category]||0)+amount;});
  const annualTotal=Object.values(annual).reduce((a,b)=>a+b,0);
  const annualSlices=allCats
    .map(c=>({id:c.id,label:c.label,color:c.color,value:annual[c.id]||0}))
    .filter(d=>d.value>0)
    .sort((a,b)=>b.value-a.value);

  // Monthly breakdown from annual
  const byMonth={};
  annualData.filter(d=>d.year===year).forEach(({month:m,amount})=>{
    byMonth[m]=(byMonth[m]||0)+amount;
  });

  const slices  = view==='month' ? monthlySlices  : annualSlices;
  const total   = view==='month' ? monthlyTotal   : annualTotal;
  const title   = view==='month' ? `${MONTHS[month]} spending` : `${year} total (from statements)`;

  return (
    <div style={{padding:'16px 16px 0'}}>
      {/* View toggle */}
      <div style={{display:'flex',background:C.sandMid,borderRadius:12,padding:3,marginBottom:16}}>
        {[['month','This month'],['year','Full year']].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{flex:1,border:'none',borderRadius:9,
            padding:'9px 0',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:SANS,
            background:view===k?C.white:'transparent',color:view===k?C.ink:C.inkSoft,
            boxShadow:view===k?'0 1px 3px rgba(0,0,0,0.1)':'none'}}>{l}</button>
        ))}
      </div>

      {/* Donut chart */}
      <Card style={{textAlign:'center',padding:'24px 16px'}}>
        <p style={{margin:'0 0 16px',fontSize:12,color:C.inkSoft,textTransform:'uppercase',
          letterSpacing:'0.1em',fontFamily:SANS}}>{title}</p>
        {slices.length===0?(
          <div style={{padding:'32px 0',color:C.inkSoft}}>
            <PieChart size={40} color={C.sandDark} style={{marginBottom:12}}/>
            <p style={{fontFamily:SERIF,fontSize:18,color:C.inkMid}}>No data yet</p>
            <p style={{fontSize:13,marginTop:4,fontFamily:SANS}}>Upload bank statements to see your spending breakdown</p>
          </div>
        ):(
          <>
            <div style={{display:'flex',justifyContent:'center',marginBottom:20}}>
              <DonutChart data={slices} total={total} size={200}/>
            </div>
            {/* Legend */}
            <div style={{textAlign:'left'}}>
              {slices.map(d=>{
                const pct=((d.value/total)*100).toFixed(1);
                return (
                  <div key={d.id} style={{display:'flex',alignItems:'center',gap:10,
                    padding:'7px 0',borderBottom:`1px solid ${C.sandMid}`}}>
                    <div style={{width:10,height:10,borderRadius:3,background:d.color,flexShrink:0}}/>
                    <span style={{flex:1,fontSize:13,color:C.ink,fontFamily:SANS}}>{d.label}</span>
                    <span style={{fontSize:11,color:C.inkSoft,fontFamily:SANS}}>{pct}%</span>
                    <span style={{fontFamily:SERIF,fontSize:15,fontWeight:600,color:C.ink,
                      minWidth:72,textAlign:'right'}}>{fmt(d.value)}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Monthly bar chart (year view) */}
      {view==='year'&&annualLoaded&&Object.keys(byMonth).length>0&&(
        <Card>
          <p style={{margin:'0 0 12px',fontSize:11,color:C.inkSoft,textTransform:'uppercase',
            letterSpacing:'0.1em',fontFamily:SANS}}>Monthly totals — {year}</p>
          {(() => {
            const maxVal=Math.max(...Object.values(byMonth),1);
            return Array.from({length:12},(_,m)=>{
              const val=byMonth[m]||0;
              const pct=(val/maxVal)*100;
              return (
                <div key={m} style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                  <span style={{fontSize:11,color:C.inkSoft,fontFamily:SANS,width:28,flexShrink:0}}>
                    {MONTHS_SHORT[m]}
                  </span>
                  <div style={{flex:1,height:20,background:C.sandMid,borderRadius:4,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${pct}%`,background:C.green,borderRadius:4,
                      transition:'width 0.4s ease'}}/>
                  </div>
                  <span style={{fontFamily:SERIF,fontSize:13,fontWeight:600,color:C.ink,
                    minWidth:64,textAlign:'right'}}>{val>0?fmt(val):'—'}</span>
                </div>
              );
            });
          })()}
        </Card>
      )}
    </div>
  );
}


// ─── UPLOAD TAB v7 ────────────────────────────────────────────────────────────
// Supports CSV and PDF. PDF uses Claude document vision.
// Pipeline: pick → [processing modal] → validate issues → review → done
// Smart checks: duplicates, income/credit, large transactions
function UploadTab({showToast, onImported, allCats}) {
  const [source,     setSource]    = useState('BMO');
  const [who,        setWho]       = useState('jordan');
  const [step,       setStep]      = useState('pick');
  const [fileType,   setFileType]  = useState(null);
  const [parsed,     setParsed]    = useState([]);
  const [edits,      setEdits]     = useState({});
  const [issues,     setIssues]    = useState([]);
  const [answers,    setAnswers]   = useState({});
  const [error,      setError]     = useState(null);
  const [csvFailed,  setCsvFailed] = useState(false);
  const [modal,      setModal]     = useState(null);
  const [pdfMeta,    setPdfMeta]   = useState(null);
  const [saving,     setSaving]    = useState(false);

  const tick = () => new Promise(r => setTimeout(r, 50));

  // After issue resolution, compute which rows to actually import
  const finalRows = parsed.filter(row => {
    // Duplicate against already-imported data (only ever tagged on this row)
    const dupEx = issues.find(i => i.type === 'duplicate_existing' && i.row.id === row.id);
    if (dupEx) {
      const ans = answers[dupEx.id] ?? dupEx.default;
      if (ans === 'Skip — already imported') return false;
    }
    // Duplicate inside this batch — the issue covers a PAIR of rows, so check both
    const dupBatch = issues.find(i =>
      i.type === 'duplicate_in_batch' &&
      (i.secondId === row.id || i.firstId === row.id)
    );
    if (dupBatch) {
      const ans = answers[dupBatch.id] ?? dupBatch.default;
      if (ans === 'Keep first only'  && dupBatch.secondId === row.id) return false;
      if (ans === 'Keep second only' && dupBatch.firstId  === row.id) return false;
    }
    const cr = issues.find(i => i.type === 'credit_check' && i.row.id === row.id);
    if (cr) {
      const ans = answers[cr.id] ?? cr.default;
      if (ans.startsWith('Yes')) return false;
    }
    const lg = issues.find(i => i.type === 'large_transaction' && i.row.id === row.id);
    if (lg) {
      const ans = answers[lg.id] ?? lg.default;
      if (ans.startsWith('Looks wrong')) return false;
    }
    if (edits[row.id]?.skip) return false;
    return true;
  }).map(row => ({
    ...row,
    category: edits[row.id]?.cat  || row.category,
    note:     edits[row.id]?.note || row.note || '',
    who,
  }));

  const byMonth = {};
  finalRows.forEach(r => {
    const k = MONTHS[r.month] + ' ' + r.year;
    if (!byMonth[k]) byMonth[k] = [];
    byMonth[k].push(r);
  });

  // ── Main parse pipeline ──────────────────────────────────────────────────────
  async function runPipeline(file) {
    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    setError(null); setCsvFailed(false); setPdfMeta(null);
    setFileType(isPDF ? 'pdf' : 'csv');
    let rawRows = [];

    if (isPDF) {
      if (!PDF_AVAILABLE) {
        setError('PDF parsing requires VITE_ANTHROPIC_API_KEY in your Netlify environment variables.');
        return;
      }
      setModal({ title: 'Claude is reading your PDF', sub: 'Analysing every page of your bank statement. This takes 10–30 seconds — please wait.' });
      await tick();
      try {
        const result = await parsePDFStatement(file, source);
        rawRows = result.rows;
        setPdfMeta({ account: result.account, period: result.period, warnings: result.warnings });
      } catch (err) {
        setModal(null);
        setError('PDF parsing failed: ' + err.message + '\n\nMake sure your VITE_ANTHROPIC_API_KEY is set in Netlify.');
        return;
      }
    } else {
      setModal({ title: 'Reading your file', sub: 'Parsing columns and extracting transaction data…' });
      await tick();
      const text = await file.text().catch(() => null);
      if (!text) { setModal(null); setError('Could not read file.'); return; }
      const { rows, error: pe, debug } = parseStatementCSV(text, source);
      if (pe || rows.length === 0) {
        setModal(null);
        setCsvFailed(true);
        setError((pe || 'No transactions found.') + '\n\nFormat: ' + (debug?.format || 'unknown') + ' · Headers: ' + (debug?.headers?.slice(0,5).join(', ') || 'none'));
        return;
      }
      rawRows = rows;
    }

    setModal({ title: 'Categorising ' + rawRows.length + ' transactions', sub: 'Matching merchants to your budget categories using months of spending history…' });
    await tick();

    // AI pass for unrecognised merchants
    const others = rawRows.filter(r => r.category === 'other');
    if (AI_AVAILABLE && others.length > 0) {
      setModal({ title: 'Asking Claude to help', sub: others.length + ' merchants weren\'t recognised. Getting AI category suggestions now…' });
      await tick();
      try {
        const catIds = allCats.map(c => c.id);
        const aiMap  = await aiCategorize(others, catIds);
        rawRows.forEach(r => { if (aiMap[r.id]) r.category = aiMap[r.id]; });
      } catch {}
    }

    // Smart validation pass
    setModal({ title: 'Running smart checks', sub: 'Checking for duplicates, income transactions, and data anomalies…' });
    await tick();

    let existingRows = [];
    try { existingRows = await getAllBankImportsRaw(); } catch {}
    const found = buildValidationReport(rawRows, existingRows);

    setModal(null);
    const withWho = rawRows.map(r => ({ ...r, who }));
    setParsed(withWho);
    setEdits({});
    setIssues(found);
    setAnswers(Object.fromEntries(found.map(i => [i.id, i.default])));
    setStep(found.length > 0 ? 'validate' : 'review');
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await runPipeline(file);
  }

  async function confirmImport() {
    setSaving(true);
    const toSave = finalRows.map(({ _type, _confidence, _fromPDF, ...r }) => r);
    try {
      await insertBankImports(toSave);
      onImported();
      showToast('Imported ' + toSave.length + ' transactions');
      setStep('done');
    } catch (err) { showToast('Import failed — ' + err.message); }
    setSaving(false);
  }

  function reset() {
    setStep('pick'); setParsed([]); setEdits({}); setIssues([]);
    setAnswers({}); setError(null); setCsvFailed(false);
    setPdfMeta(null); setFileType(null); setModal(null);
  }

  // ── Processing overlay (shown during all async stages) ───────────────────────
  const ProcessingOverlay = modal ? (
    <div style={{ position:'fixed', inset:0, zIndex:800, background:'rgba(26,26,24,0.78)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
      <div style={{ background:C.white, borderRadius:20, padding:'32px 28px',
        maxWidth:340, width:'100%', textAlign:'center',
        boxShadow:'0 24px 48px rgba(0,0,0,0.3)' }}>
        <Spinner size={40}/>
        <h2 style={{ fontFamily:SERIF, fontSize:22, fontWeight:600,
          color:C.ink, margin:'16px 0 8px' }}>{modal.title}</h2>
        <p style={{ fontSize:13, color:C.inkMid, margin:'0 0 20px',
          fontFamily:SANS, lineHeight:1.7 }}>{modal.sub}</p>
        <div style={{ background:C.redLight, border:'1px solid rgba(192,57,43,0.15)',
          borderRadius:10, padding:'10px 14px' }}>
          <p style={{ margin:0, fontSize:12, fontWeight:700, color:C.red, fontFamily:SANS }}>
            ⚠ Do not close or refresh this page
          </p>
          <p style={{ margin:'3px 0 0', fontSize:11, color:C.red+'99', fontFamily:SANS }}>
            Your data is being processed. It will be ready shortly.
          </p>
        </div>
      </div>
    </div>
  ) : null;

  // ── PICK SCREEN ──────────────────────────────────────────────────────────────
  if (step === 'pick') return (
    <div style={{ padding:'16px 16px 0' }}>
      {ProcessingOverlay}

      {/* Welcome card */}
      <div style={{ background:'linear-gradient(135deg,#1a7a4a,#2d9d61)',
        borderRadius:16, padding:'20px 18px', marginBottom:14, color:'#fff' }}>
        <p style={{ margin:'0 0 6px', fontSize:16, fontWeight:700, fontFamily:SERIF }}>
          Upload a bank statement
        </p>
        <p style={{ margin:'0 0 10px', fontSize:13, fontFamily:SANS,
          color:'rgba(255,255,255,0.85)', lineHeight:1.6 }}>
          Works with <b>CSV or PDF</b>. Every upload is cross-checked for duplicates
          and income transactions before anything is saved.
          The more months you upload, the smarter your budgets get.
        </p>
        <p style={{ margin:0, fontSize:12, color:'rgba(255,255,255,0.65)', fontFamily:SANS }}>
          💡 Having trouble with CSV? Try the PDF version — Claude reads it directly.
        </p>
      </div>

      {/* CSV failed → offer PDF */}
      {csvFailed && (
        <div style={{ background:'#fffbeb', border:'1.5px solid #b45309',
          borderRadius:14, padding:'16px', marginBottom:14 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:12 }}>
            <AlertCircle size={18} color={C.amber} style={{ flexShrink:0, marginTop:2 }}/>
            <div>
              <p style={{ margin:'0 0 4px', fontSize:14, fontWeight:700,
                color:C.amber, fontFamily:SANS }}>
                That CSV didn\'t work — but that\'s okay
              </p>
              <p style={{ margin:'0 0 8px', fontSize:13, color:'#92400e',
                fontFamily:SANS, lineHeight:1.6 }}>
                Banks don\'t always export clean CSV files — it\'s their problem, not yours.
                Try uploading the <b>PDF version</b> of your statement instead.
                Claude will read every page and extract all transactions automatically.
              </p>
              {error && (
                <div style={{ background:'rgba(0,0,0,0.05)', borderRadius:7,
                  padding:'6px 10px', fontFamily:'monospace', fontSize:11,
                  color:'#92400e', whiteSpace:'pre-wrap' }}>{error}</div>
              )}
            </div>
          </div>
          {PDF_AVAILABLE ? (
            <label style={{ display:'block', padding:'14px', borderRadius:11,
              background:C.amber, cursor:'pointer', textAlign:'center',
              fontSize:14, fontWeight:700, color:'#fff', fontFamily:SANS,
              position:'relative', overflow:'hidden', boxSizing:'border-box' }}>
              📄 Try uploading the PDF instead →
              <input type="file" accept=".pdf,application/pdf" onChange={handleFile}
                style={{ position:'absolute', top:0, left:0, width:'100%',
                  height:'100%', opacity:0, cursor:'pointer' }}/>
            </label>
          ) : (
            <div style={{ background:'rgba(0,0,0,0.06)', borderRadius:9,
              padding:'10px 12px' }}>
              <p style={{ margin:0, fontSize:12, color:'#92400e', fontFamily:SANS }}>
                To enable PDF parsing, add <b>VITE_ANTHROPIC_API_KEY</b> to your
                Netlify environment variables and redeploy.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Generic error (non-CSV-fail) */}
      {error && !csvFailed && (
        <div style={{ background:C.redLight, border:'1px solid rgba(192,57,43,0.2)',
          borderRadius:12, padding:'12px 16px', marginBottom:14 }}>
          <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:600, color:C.red, fontFamily:SANS }}>
            Upload failed
          </p>
          <p style={{ margin:0, fontSize:12, color:C.red,
            fontFamily:'monospace', whiteSpace:'pre-wrap' }}>{error}</p>
        </div>
      )}

      {AI_AVAILABLE && !csvFailed && (
        <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:12,
          padding:'10px 14px', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
          <Sparkles size={13} color={C.purple}/>
          <p style={{ margin:0, fontSize:12, color:'#5b21b6', fontFamily:SANS }}>
            Claude AI connected — PDF reading, smart categorisation, and data validation active.
          </p>
        </div>
      )}

      <SL>Source account</SL>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14 }}>
        {SOURCES.map(s => (
          <button key={s.id} onClick={() => setSource(s.id)} style={{
            border: '1.5px solid ' + (source===s.id ? C.blue : C.sandDark),
            borderRadius:12, padding:'12px 14px',
            background: source===s.id ? '#eff6ff' : C.white,
            cursor:'pointer', fontSize:13, fontWeight:600,
            color: source===s.id ? C.blue : C.inkMid,
            textAlign:'left', fontFamily:SANS }}>
            {s.label}
          </button>
        ))}
      </div>

      <SL>Spending belongs to</SL>
      <div style={{ display:'flex', gap:8, marginBottom:24 }}>
        {[['jordan','Jordan','#1d4ed8','#eff6ff'],['ness','Ness','#be185d','#fdf2f8']].map(([k,l,col,bg]) => (
          <button key={k} onClick={() => setWho(k)} style={{ flex:1,
            border: '1.5px solid ' + (who===k ? col : C.sandDark),
            borderRadius:12, padding:'11px',
            background: who===k ? bg : C.white, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <div style={{ width:24, height:24, borderRadius:'50%', background:col, color:'#fff',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:9, fontWeight:700 }}>
              {k==='jordan'?'JY':'NMK'}
            </div>
            <span style={{ fontSize:13, fontWeight:600,
              color:who===k?col:C.inkMid, fontFamily:SANS }}>{l}</span>
          </button>
        ))}
      </div>

      {/* Main upload button — accepts CSV AND PDF */}
      <label style={{ display:'block', width:'100%', padding:'18px', borderRadius:14,
        background:C.ink, cursor:'pointer', textAlign:'center', fontSize:15,
        fontWeight:600, color:'#fff', fontFamily:SANS,
        boxSizing:'border-box', position:'relative', overflow:'hidden' }}>
        <Upload size={18} style={{ verticalAlign:'middle', marginRight:10 }}/>
        Choose file (CSV or PDF)
        <input type="file"
          accept=".csv,.CSV,.pdf,.PDF,text/csv,text/plain,application/pdf"
          onChange={handleFile}
          style={{ position:'absolute', top:0, left:0, width:'100%',
            height:'100%', opacity:0, cursor:'pointer' }}/>
      </label>
      <p style={{ textAlign:'center', fontSize:12, color:C.inkSoft, marginTop:10, fontFamily:SANS }}>
        CSV or PDF · BMO · CTFS · Wealthsimple · PC Mastercard · CIBC
      </p>
    </div>
  );

  // ── VALIDATE SCREEN — smart issue-by-issue confirmation ───────────────────────
  if (step === 'validate') return (
    <div style={{ padding:'16px 16px 0' }}>
      {ProcessingOverlay}

      <div style={{ marginBottom:14 }}>
        <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
          Quick data check
        </h2>
        <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
          Found {parsed.length} transactions. Please answer {issues.length}{' '}
          question{issues.length!==1?'s':''} so we get your financial history exactly right.
        </p>
      </div>

      {pdfMeta?.account && (
        <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd',
          borderRadius:12, padding:'10px 14px', marginBottom:12 }}>
          <p style={{ margin:0, fontSize:12, color:'#5b21b6', fontFamily:SANS }}>
            📄 {pdfMeta.account}{pdfMeta.period ? ' · ' + pdfMeta.period : ''}
          </p>
          {(pdfMeta.warnings||[]).map((w,i) => (
            <p key={i} style={{ margin:'4px 0 0', fontSize:11, color:'#7c3aed', fontFamily:SANS }}>⚠ {w}</p>
          ))}
        </div>
      )}

      {issues.map((issue, idx) => {
        const ans  = answers[issue.id] ?? issue.default;
        const icons = { duplicate_in_batch:'🔁', duplicate_existing:'📋', credit_check:'💰', large_transaction:'🔍' };
        const colors = { duplicate_in_batch:C.blue, duplicate_existing:C.blue, credit_check:C.green, large_transaction:C.amber };
        const borderColor = colors[issue.type] || C.amber;

        return (
          <div key={issue.id} style={{ background:C.white, borderRadius:14,
            padding:'16px', marginBottom:12,
            boxShadow:'0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
            borderLeft: '4px solid ' + borderColor }}>

            <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:10 }}>
              <div style={{ width:30, height:30, borderRadius:99,
                background: borderColor + '18',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:16, flexShrink:0 }}>
                {icons[issue.type] || '❓'}
              </div>
              <div style={{ flex:1 }}>
                <p style={{ margin:'0 0 2px', fontSize:10, color:borderColor,
                  textTransform:'uppercase', letterSpacing:'0.08em',
                  fontFamily:SANS, fontWeight:700 }}>
                  Check {idx + 1} of {issues.length}
                </p>
                <p style={{ margin:0, fontSize:14, color:C.ink,
                  fontFamily:SANS, lineHeight:1.65 }}>
                  {issue.question}
                </p>
              </div>
            </div>

            {/* Transaction preview */}
            <div style={{ background:C.sand, borderRadius:9, padding:'10px 14px',
              marginBottom:12, display:'flex', justifyContent:'space-between',
              alignItems:'center', gap:8 }}>
              <div style={{ minWidth:0 }}>
                <p style={{ margin:0, fontSize:13, fontWeight:600,
                  color:C.ink, fontFamily:SANS,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {issue.row.description}
                </p>
                <p style={{ margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                  {issue.row.date} · {issue.row.source || source}
                </p>
              </div>
              <p style={{ margin:0, fontFamily:SERIF, fontSize:18,
                fontWeight:700, color:C.ink, flexShrink:0 }}>
                ${issue.row.amount.toFixed(2)}
              </p>
            </div>

            {/* Option buttons */}
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {issue.options.map(opt => (
                <button key={opt}
                  onClick={() => setAnswers(p => ({ ...p, [issue.id]: opt }))}
                  style={{ border: '1.5px solid ' + (ans===opt ? C.green : C.sandDark),
                    borderRadius:10, padding:'10px 14px', cursor:'pointer',
                    background: ans===opt ? C.greenLight : C.white,
                    display:'flex', alignItems:'center', gap:10, textAlign:'left' }}>
                  <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0,
                    border: '2px solid ' + (ans===opt ? C.green : C.sandDark),
                    background: ans===opt ? C.green : 'transparent' }}/>
                  <span style={{ fontSize:13, fontWeight:ans===opt?600:400,
                    color:ans===opt?C.green:C.inkMid, fontFamily:SANS }}>
                    {opt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <button onClick={() => setStep('review')}
        style={{ width:'100%', border:'none', padding:'16px', borderRadius:14,
          background:C.green, color:'#fff', fontSize:15, fontWeight:700,
          cursor:'pointer', fontFamily:SANS, marginBottom:8 }}>
        All answered — review {finalRows.length} transactions →
      </button>
      <p style={{ textAlign:'center', fontSize:11, color:C.inkSoft,
        fontFamily:SANS, margin:'0 0 16px' }}>
        Your answers above will exclude {parsed.length - finalRows.length} transactions from import.
      </p>
    </div>
  );

  // ── REVIEW SCREEN ────────────────────────────────────────────────────────────
  if (step === 'review') return (
    <div style={{ padding:'16px 16px 0' }}>
      {ProcessingOverlay}
      <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center' }}>
        <button onClick={() => issues.length > 0 ? setStep('validate') : reset()}
          style={{ border:'1px solid ' + C.sandDark, borderRadius:8, padding:'6px 12px',
            background:C.white, fontSize:13, color:C.ink, cursor:'pointer', fontFamily:SANS }}>
          ← Back
        </button>
        <div style={{ flex:1 }}>
          <p style={{ margin:0, fontSize:14, fontWeight:600, color:C.ink, fontFamily:SANS }}>
            {finalRows.length} transactions to import
          </p>
          <p style={{ margin:0, fontSize:12, color:C.inkSoft, fontFamily:SANS }}>
            {fileType==='pdf'?'Parsed from PDF':'Parsed from CSV'}
            {Object.keys(byMonth).length > 1 ? ' · ' + Object.keys(byMonth).length + ' months' : ''}
          </p>
        </div>
        <button onClick={confirmImport} disabled={saving || finalRows.length === 0}
          style={{ border:'none', borderRadius:10, padding:'9px 18px', cursor:'pointer',
            fontFamily:SANS, fontSize:14, fontWeight:600,
            background: finalRows.length>0 ? C.green : C.sandDark,
            color: finalRows.length>0 ? '#fff' : C.inkSoft,
            display:'flex', alignItems:'center', gap:6 }}>
          {saving ? (<><Spinner size={14}/><span>…</span></>) : 'Import all'}
        </button>
      </div>

      {Object.entries(byMonth).map(([mk, rows]) => (
        <div key={mk}>
          <SL>{mk} — {rows.length} transactions · {fmt(rows.reduce((a,r)=>a+r.amount,0))}</SL>
          <Card style={{ padding:'4px 0', marginBottom:12 }}>
            {rows.map((tx, i) => {
              const ec  = edits[tx.id]?.cat || tx.category;
              const skp = !!edits[tx.id]?.skip;
              const c   = allCats.find(x => x.id === ec) || { icon:'Package', color:C.inkSoft };
              const lowConf = tx._confidence === 'low';
              return (
                <div key={tx.id}>
                  {i > 0 && <Divider/>}
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px',
                    opacity: skp ? 0.4 : 1,
                    background: skp ? C.sandMid : lowConf ? '#fffbeb' : C.white }}>
                    <button
                      onClick={() => setEdits(p=>({...p,[tx.id]:{...p[tx.id],skip:!p[tx.id]?.skip}}))}
                      style={{ border:'none', background:'none', padding:0, cursor:'pointer', flexShrink:0 }}>
                      <div style={{ width:20, height:20, borderRadius:5,
                        border: '1.5px solid ' + (skp ? C.sandDark : C.green),
                        background: skp ? 'transparent' : C.green,
                        display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {!skp && <Check size={12} color="#fff" strokeWidth={3}/>}
                      </div>
                    </button>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:12, color:C.ink, fontFamily:SANS,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {tx.description}
                        {lowConf && <span style={{ marginLeft:6, fontSize:10, color:C.amber, fontWeight:600 }}> low confidence</span>}
                      </p>
                      <p style={{ margin:0, fontSize:10, color:C.inkSoft, fontFamily:SANS }}>
                        {tx.date}{tx._type==='credit' ? ' · CREDIT/INCOME' : ''}
                      </p>
                    </div>
                    <select value={ec}
                      onChange={e => setEdits(p=>({...p,[tx.id]:{...p[tx.id],cat:e.target.value}}))}
                      style={{ border:'1px solid ' + c.color, borderRadius:7, padding:'3px 6px',
                        fontSize:10, fontWeight:700, color:c.color, background:'#fff',
                        cursor:'pointer', fontFamily:SANS, maxWidth:100 }}>
                      {allCats.map(x => (<option key={x.id} value={x.id}>{x.label}</option>))}
                    </select>
                    <p style={{ margin:0, fontFamily:SERIF, fontSize:15, fontWeight:600,
                      color:C.ink, minWidth:58, textAlign:'right' }}>
                      {fmt(tx.amount)}
                    </p>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      ))}

      <button onClick={confirmImport} disabled={saving || finalRows.length === 0}
        style={{ border:'none', width:'100%', padding:'16px', borderRadius:14,
          fontSize:15, fontWeight:600, fontFamily:SANS,
          background: finalRows.length>0 ? C.green : C.sandDark,
          color: finalRows.length>0 ? '#fff' : C.inkSoft,
          cursor: finalRows.length>0 ? 'pointer' : 'default',
          display:'flex', alignItems:'center', justifyContent:'center',
          gap:8, marginBottom:16 }}>
        {saving
          ? (<><Spinner/><span>Importing…</span></>)
          : 'Import ' + finalRows.length + ' transaction' + (finalRows.length!==1?'s':'')}
      </button>
    </div>
  );

  // ── DONE ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding:'16px 16px 0' }}>
      <Card style={{ background:C.greenLight, border:'1px solid rgba(26,122,74,0.2)',
        textAlign:'center', padding:'32px 20px' }}>
        <Check size={48} color={C.green} style={{ marginBottom:12 }}/>
        <h2 style={{ fontFamily:SERIF, fontSize:26, fontWeight:600, color:C.green, margin:'0 0 8px' }}>
          Imported
        </h2>
        <p style={{ margin:0, fontSize:14, color:C.green+'cc', fontFamily:SANS }}>
          {finalRows.length} transactions saved. Duplicates and income transactions were filtered out.
        </p>
        <p style={{ margin:'10px 0 0', fontSize:12, color:C.green+'99', fontFamily:SANS, lineHeight:1.6 }}>
          The more months you upload, the more accurately the app can predict your spending
          and set smart budget targets. Keep going — past statements are just as valuable.
        </p>
      </Card>
      <button onClick={reset}
        style={{ border:'none', width:'100%', padding:'15px', borderRadius:14,
          fontSize:14, fontWeight:600, background:C.ink, color:'#fff',
          cursor:'pointer', fontFamily:SANS }}>
        Upload another statement
      </button>
    </div>
  );
}


// ─── Partner activity ─────────────────────────────────────────────────────────
// Describes a realtime change in plain language, e.g.
//   "Ness added $42.10 to Groceries"
function describeChange(payload, allCats) {
  const row  = payload.new || payload.old || {};
  const evt  = payload.eventType || payload.type;
  const who  = (row.who || 'Your partner');
  const name = who.charAt(0).toUpperCase() + who.slice(1).split(' ')[0];

  if (payload.table === 'budget_settings') {
    return { who: name, text: `${name} updated the income or credit-card targets` };
  }

  const catId = row.cat || row.category;
  const cat   = allCats.find(c => c.id === catId);
  const label = cat ? cat.label : 'a category';
  const amt   = row.amount != null ? fmt(row.amount) : '';

  if (evt === 'INSERT') {
    return payload.table === 'bank_imports'
      ? { who:name, text:`${name} imported a transaction — ${amt} in ${label}` }
      : { who:name, text:`${name} added ${amt} to ${label}` };
  }
  if (evt === 'UPDATE') return { who:name, text:`${name} edited a ${label} transaction` };
  if (evt === 'DELETE') return { who:name, text:`${name} removed a transaction` };
  return { who:name, text:`${name} made a change` };
}

function ActivityPanel({ items, onClose, onClear }) {
  return (
    <div style={{ position:'fixed', inset:0, zIndex:700,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose}
        style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.55)' }}/>
      <div style={{ position:'relative', background:C.white,
        borderRadius:'20px 20px 0 0', maxHeight:'70dvh',
        display:'flex', flexDirection:'column', animation:'slideUp 0.25s ease' }}>

        <div style={{ padding:'20px 20px 12px', borderBottom:`1px solid ${C.sandMid}`,
          display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
              Partner activity
            </h2>
            <p style={{ margin:'3px 0 0', fontSize:12, color:C.inkSoft, fontFamily:SANS }}>
              Changes your budget partner made, newest first.
            </p>
          </div>
          <button onClick={onClose}
            style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'12px 16px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign:'center', padding:'40px 0' }}>
              <Bell size={36} color={C.sandDark} style={{ marginBottom:10 }}/>
              <p style={{ fontFamily:SERIF, fontSize:18, color:C.inkMid, margin:0 }}>
                Nothing new
              </p>
              <p style={{ fontSize:13, color:C.inkSoft, fontFamily:SANS, marginTop:4 }}>
                You'll see it here the moment your partner adds or imports anything.
              </p>
            </div>
          ) : items.map(n => (
            <div key={n.id} style={{ display:'flex', gap:11, alignItems:'flex-start',
              padding:'11px 0', borderBottom:`1px solid ${C.sandMid}` }}>
              <UserAvatar name={n.who} size={30}/>
              <div style={{ flex:1, minWidth:0 }}>
                <p style={{ margin:0, fontSize:14, color:C.ink,
                  fontFamily:SANS, lineHeight:1.5 }}>{n.text}</p>
                <p style={{ margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                  {new Date(n.at).toLocaleString('en-CA',
                    { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                </p>
              </div>
            </div>
          ))}
          <div style={{ height:12 }}/>
        </div>

        <div style={{ padding:'12px 16px 24px', borderTop:`1px solid ${C.sandMid}` }}>
          <button onClick={onClear} disabled={items.length === 0}
            style={{ width:'100%', border:'none', padding:'13px', borderRadius:12,
              background: items.length ? C.ink : C.sandDark,
              color: items.length ? '#fff' : C.inkSoft,
              fontSize:14, fontWeight:600,
              cursor: items.length ? 'pointer' : 'default', fontFamily:SANS }}>
            Mark all as read
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
const SUPABASE_READY=!!(import.meta.env.VITE_SUPABASE_URL&&import.meta.env.VITE_SUPABASE_ANON_KEY);
const CUSTOM_CATS_KEY='b42_custom_cats';
const CAT_TARGETS_KEY='b42_cat_targets';
const NOTIFS_KEY='b42_notifs';
const DEF_INCOME={jordan:3984.44,ness:800,sunlife:0};

export default function App() {
  const now=new Date();
  // Auth
  const [authState,setAuthState]=useState('loading'); // loading|auth|app
  const [profile,  setProfile  ]=useState(null);      // user_metadata
  // App state
  const [tab,        setTab       ]=useState('home');
  const [month,      setMonth     ]=useState(now.getMonth());
  const [year,       setYear      ]=useState(now.getFullYear());
  const [txns,       setTxns      ]=useState([]);
  const [imports,    setImports   ]=useState([]);
  const [income,     setIncome    ]=useState(DEF_INCOME);
  const [ccTarget,   setCcTarget  ]=useState(500);
  const [customCats, setCustomCats]=useState([]);
  const [catTargets, setCatTargets]=useState({});
  const [suggested,  setSuggested ]=useState({});
  const [toast,      setToast     ]=useState(null);
  const [showReview, setShowReview]=useState(false);
  const [otherItems, setOtherItems]=useState([]);
  const [notifs,     setNotifs    ]=useState([]);
  const [showActivity,setShowActivity]=useState(false);

  const allCats=[...DEFAULT_CATS,...customCats];

  // ── Auth init ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    // Load local prefs immediately (don't block on auth)
    try {
      const cc=localStorage.getItem(CUSTOM_CATS_KEY); if(cc)setCustomCats(JSON.parse(cc));
      const ct=localStorage.getItem(CAT_TARGETS_KEY); if(ct)setCatTargets(JSON.parse(ct));
      const nf=localStorage.getItem(NOTIFS_KEY);      if(nf)setNotifs(JSON.parse(nf));
    } catch {}

    if(!SUPABASE_READY){setAuthState('auth');return;}

    // Check existing session
    supabase.auth.getSession().then(({data:{session}})=>{
      if(session?.user){
        const meta=session.user.user_metadata;
        if(meta?.name){setProfile({...meta,email:session.user.email,id:session.user.id});setAuthState('app');}
        else{setAuthState('auth');}
      } else {
        setAuthState('auth');
      }
    });

    // Listen for future auth changes
    const unsub=onAuthChange((event,session)=>{
      if(event==='SIGNED_IN'&&session?.user){
        const meta=session.user.user_metadata;
        if(meta?.name){setProfile({...meta,email:session.user.email,id:session.user.id});setAuthState('app');}
        else{setAuthState('auth');}
      }
      if(event==='SIGNED_OUT'){setProfile(null);setAuthState('auth');}
    });
    return unsub;
  },[]);

  // ── Load data ────────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(authState!=='app'||!SUPABASE_READY)return;
    loadAll();
  },[authState,month,year]);

  async function loadAll(){
    try{
      const [t,b,s,ai]=await Promise.all([getTxns(year,month),getBankImports(year,month),
        getSettings(year,month),getAllBankImports()]);
      setTxns(t);setImports(b);
      setIncome(s?.income||DEF_INCOME);setCcTarget(s?.cc_target??500);
      if(ai.length>20){const nt=computeTargets(ai);if(Object.keys(nt).length>0)setSuggested(nt);}
    }catch(e){showToast('Load error: '+e.message);}
  }

  async function openReview() {
    try {
      const items = await getOtherImports(year, month);
      setOtherItems(items);
      setShowReview(true);
    } catch(e) { showToast('Could not load items: '+e.message); }
  }

  async function handleSaveNote(id, type, note) {
    try {
      if (type === 'import') {
        await updateBankImport(id, { note });
        setImports(prev => prev.map(t => t.id === id ? { ...t, note } : t));
      } else {
        await updateTransaction(id, { note });
        setTxns(prev => prev.map(t => t.id === id ? { ...t, note } : t));
      }
    } catch(e) { showToast('Could not save note'); }
  }

  useEffect(()=>{
    if(authState!=='app'||!SUPABASE_READY)return;
    const unsub=subscribeToMonth(year,month,
      ()=>getTxns(year,month).then(setTxns).catch(()=>{}),
      ()=>getSettings(year,month).then(s=>{if(s){setIncome(s.income);setCcTarget(s.cc_target);}}).catch(()=>{}),
      ()=>getBankImports(year,month).then(setImports).catch(()=>{}),
    );
    return unsub;
  },[authState,month,year]);

  // ── Partner activity (whole-budget realtime, any month) ──────────────────────
  useEffect(()=>{
    if(authState!=='app'||!SUPABASE_READY||!profile)return;
    const me=(profile.name||'').toLowerCase().split(' ')[0];

    const unsub=subscribeToPartnerActivity(payload=>{
      const row=payload.new||payload.old||{};
      const actor=(row.who||'').toLowerCase();
      // Ignore our own writes — only surface the partner's changes
      if(actor && me && (actor.includes(me)||me.includes(actor)))return;
      // budget_settings rows carry no 'who'; skip rather than misattribute
      if(!actor && payload.table==='budget_settings')return;

      const {who,text}=describeChange(payload,allCats);
      const entry={id:uid(),who,text,at:Date.now()};
      setNotifs(prev=>{
        const next=[entry,...prev].slice(0,50);
        try{localStorage.setItem(NOTIFS_KEY,JSON.stringify(next));}catch{}
        return next;
      });
      showToast(text);
    });
    return unsub;
  },[authState,profile,customCats.length]);

  function clearNotifs(){
    setNotifs([]);
    try{localStorage.removeItem(NOTIFS_KEY);}catch{}
    setShowActivity(false);
  }

  // ── Debounced settings save ──────────────────────────────────────────────────
  const saveRef=useRef(null);
  async function saveSettings(incomeVal,ccVal){
    const inc=incomeVal??income; const cc=ccVal??ccTarget;
    if(saveRef.current)clearTimeout(saveRef.current);
    saveRef.current=setTimeout(async()=>{
      try{await upsertSettings(year,month,inc,cc);}catch{}
    },800);
  }

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(null),2600);}
  function changeMonth(dir){let m=month+dir,y=year;if(m<0){m=11;y--;}if(m>11){m=0;y++;}setMonth(m);setYear(y);}
  async function addTxn(tx){await insertTxn({...tx,id:uid(),ts:Date.now(),year,month});}
  async function removeTxn(id){await deleteTxn(id);}
  async function removeImport(id){await deleteBankImport(id);setImports(p=>p.filter(t=>t.id!==id));}
  function addCustomCat(cat){const u=[...customCats,cat];setCustomCats(u);localStorage.setItem(CUSTOM_CATS_KEY,JSON.stringify(u));showToast(`"${cat.label}" added`);}
  function deleteCustomCat(id){const u=customCats.filter(c=>c.id!==id);setCustomCats(u);localStorage.setItem(CUSTOM_CATS_KEY,JSON.stringify(u));}
  function acceptSuggested(){const m={...catTargets,...suggested};setCatTargets(m);localStorage.setItem(CAT_TARGETS_KEY,JSON.stringify(m));setSuggested({});showToast('Budget targets updated');}
  async function handleSignOut(){await signOut();setProfile(null);setAuthState('auth');}

  // ── Render states ────────────────────────────────────────────────────────────
  if(authState==='loading') return (
    <div style={{minHeight:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:C.sand}}>
      <div style={{textAlign:'center'}}><B42Logo size={56}/><p style={{marginTop:16,fontSize:13,color:C.inkSoft,fontFamily:SANS}}>Loading…</p></div>
    </div>
  );

  if(authState==='auth') return (
    <AuthScreen onAuth={()=>{
      supabase.auth.getSession().then(({data:{session}})=>{
        if(session?.user?.user_metadata?.name){
          setProfile({...session.user.user_metadata,email:session.user.email,id:session.user.id});
          setAuthState('app');
        }
      });
    }}/>
  );

  if(!profile) return (
    <div style={{minHeight:'100dvh',display:'flex',alignItems:'center',justifyContent:'center',background:C.sand}}>
      <Spinner size={28}/>
    </div>
  );

  const color=nameColor(profile.name);
  const NAV=[
    {id:'home',   label:'Home',   Icon:Home},
    {id:'add',    label:'Add',    Icon:Plus,    accent:true},
    {id:'history',label:'History',Icon:History},
    {id:'charts', label:'Charts', Icon:PieChart},
    {id:'upload', label:'Upload', Icon:Upload},
  ];

  return (
    <div style={{maxWidth:560,margin:'0 auto',minHeight:'100dvh',background:C.sand,
      paddingBottom:'calc(72px + env(safe-area-inset-bottom, 0px))'}}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

      {/* Header */}
      <div style={{background:C.white,borderBottom:`1px solid ${C.sandMid}`,
        padding:'10px 16px',position:'sticky',top:0,zIndex:50,
        display:'flex',alignItems:'center',gap:10}}>
        <B42Badge/>
        <button onClick={()=>changeMonth(-1)} style={{border:`1px solid ${C.sandDark}`,borderRadius:8,
          padding:'5px 10px',background:C.white,fontSize:16,color:C.inkMid,lineHeight:1,cursor:'pointer'}}>‹</button>
        <p style={{flex:1,margin:0,fontFamily:SERIF,fontSize:17,fontWeight:600,
          color:C.ink,textAlign:'center',letterSpacing:'-0.01em'}}>{MONTHS[month]} {year}</p>
        <button onClick={()=>changeMonth(1)} style={{border:`1px solid ${C.sandDark}`,borderRadius:8,
          padding:'5px 10px',background:C.white,fontSize:16,color:C.inkMid,lineHeight:1,cursor:'pointer'}}>›</button>
        <button onClick={()=>setShowActivity(true)}
          title="Partner activity"
          style={{border:'none',background:'none',padding:'5px 4px',
            cursor:'pointer',position:'relative',display:'flex',alignItems:'center'}}>
          {notifs.length>0
            ? <BellRing size={19} color={C.green} strokeWidth={2}/>
            : <Bell size={19} color={C.sandDark} strokeWidth={1.6}/>}
          {notifs.length>0&&(
            <span style={{position:'absolute',top:1,right:0,minWidth:15,height:15,
              borderRadius:99,background:C.red,color:'#fff',fontSize:9,fontWeight:700,
              display:'flex',alignItems:'center',justifyContent:'center',
              padding:'0 3px',fontFamily:SANS,border:`1.5px solid ${C.white}`}}>
              {notifs.length>9?'9+':notifs.length}
            </span>
          )}
        </button>
        <button onClick={handleSignOut}
          title="Sign out"
          style={{border:'none',borderRadius:99,padding:'5px 10px 5px 7px',
            background:color+'15',display:'flex',alignItems:'center',gap:6,cursor:'pointer'}}>
          <UserAvatar name={profile.name} size={20}/>
          <span style={{fontSize:11,fontWeight:700,color,fontFamily:SANS}}>
            {profile.name.split(' ')[0]}
          </span>
        </button>
      </div>

      {/* Content */}
      {tab==='home'    && <HomeTab txns={txns} bankImports={imports} income={income} ccTarget={ccTarget}
          setIncome={setIncome} setCcTarget={setCcTarget} allCats={allCats} catTargets={catTargets}
          onSaveSettings={saveSettings} suggested={suggested} onAcceptSuggested={acceptSuggested}
          onAddCat={addCustomCat} onDeleteCat={deleteCustomCat} profile={profile}
          onReviewOther={openReview}
          otherCount={imports.filter(t=>(t.category||t.cat)==='other').length}/>}
      {tab==='add'     && <AddTab profile={profile} allCats={allCats} onAdd={async tx=>{await addTxn(tx);showToast(`Added ${fmt(tx.amount)}`);setTab('home');}}/>}
      {tab==='history' && <HistoryTab txns={txns} bankImports={imports} allCats={allCats}
          onDeleteTxn={removeTxn} onDeleteImport={removeImport} onSaveNote={handleSaveNote}/>}
      {tab==='charts'  && <ChartsTab txns={txns} bankImports={imports} allCats={allCats} year={year} month={month}/>}
      {tab==='upload'  && <UploadTab showToast={showToast} onImported={loadAll} allCats={allCats}/>}

      {/* Partner activity panel */}
      {showActivity && (
        <ActivityPanel
          items={notifs}
          onClose={()=>setShowActivity(false)}
          onClear={clearNotifs}
        />
      )}

      {/* OtherReviewModal */}
      {showReview && otherItems.length > 0 && (
        <OtherReviewModal
          items={otherItems}
          allCats={allCats}
          onSave={async () => {
            setShowReview(false);
            await loadAll();
            showToast('Categories saved');
          }}
          onClose={() => setShowReview(false)}
        />
      )}

      {/* Bottom nav */}
      <div style={{position:'fixed',bottom:0,left:0,right:0,background:C.white,
        borderTop:`1px solid ${C.sandMid}`,paddingBottom:'env(safe-area-inset-bottom, 0px)',zIndex:50}}>
        <div style={{maxWidth:560,margin:'0 auto',display:'flex'}}>
          {NAV.map(({id,label,Icon,accent})=>(
            <button key={id} onClick={()=>setTab(id)} style={{flex:1,border:'none',background:'none',
              padding:'10px 0 12px',display:'flex',flexDirection:'column',alignItems:'center',gap:3,cursor:'pointer'}}>
              {accent
                ?<div style={{width:44,height:44,borderRadius:'50%',
                    background:tab==='add'?C.green:C.inkSoft,
                    display:'flex',alignItems:'center',justifyContent:'center',marginTop:-8,
                    boxShadow:tab==='add'?`0 4px 16px ${C.green}55`:'none',transition:'all 0.2s'}}>
                    <Icon size={20} color="#fff"/>
                  </div>
                :<Icon size={22} color={tab===id?C.green:C.sandDark} strokeWidth={tab===id?2:1.5}/>}
              {!accent&&<span style={{fontSize:10,fontFamily:SANS,fontWeight:tab===id?600:400,
                color:tab===id?C.green:C.inkSoft,letterSpacing:'0.02em'}}>{label}</span>}
            </button>
          ))}
        </div>
      </div>
      {toast&&<Toast msg={toast}/>}
    </div>
  );
}
