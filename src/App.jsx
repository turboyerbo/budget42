import { useState, useEffect, useRef } from 'react';
import {
  ShoppingBasket, Utensils, Wine, Car, Train, Pill, Stethoscope,
  Ticket, Code2, CreditCard, Shirt, Plane, Scissors, Scale, Package,
  Home, Plus, History, CalendarDays, Upload, PieChart,
  Tag, Coffee, Music, BookOpen, Camera, Dumbbell, Leaf, PawPrint, Brush, Baby,
  ChevronRight, Trash2, Check, X, Sparkles, AlertCircle, Eye, EyeOff, LogOut,
  Bell, BellRing, Landmark, HelpCircle, Heart, Settings, Download,
  Smartphone, Zap, Gift, Shield, ArrowLeftRight,
} from 'lucide-react';
import { supabase, getTxns, insertTxn, deleteTxn,
         getSettings, upsertSettings,
         getBankImports, insertBankImports, deleteBankImport, getAllBankImports,
         updateBankImport, updateTransaction, getOtherImports,
         subscribeToMonth, subscribeToPartnerActivity,
         signUp, signIn, signOut, onAuthChange, updateUserMeta,
         getAllBankImportsRaw, exportAllData, countMonthData, countAllData,
         deleteMonthData, deleteAllData,
         getBillRules, upsertBillRule, deleteBillRule, syncLocalBillRules,
         deleteManyRows, getMonthEverything } from './supabase.js';
import { categorize } from './categorize.js';
import { parseStatementCSV } from './parse.js';
import { aiCategorize, AI_AVAILABLE, computeTargets, suggestCategory, spendingInsight } from './ai.js';
import { parsePDFStatement, PDF_AVAILABLE } from './pdf.js';
import { checkAI, aiDiagnostics } from './claude.js';
import { detectRecurring, splitRecurring, buildSchedule, relativeDay,
         applyBillRules } from './recurring.js';
import { detectBank, INSTITUTIONS, instLabel, instColor, instKind } from './detect.js';
import { detectPartnerTransfers, findSharedMoments, summariseTogether, firstName } from './together.js';
import { buildValidationReport, findExistingDuplicates } from './validate.js';

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
  {id:'alcohol',      label:'Alcohol & cigs',        icon:'Wine',           target:175, color:'#7c3aed'},
  {id:'banking',      label:'Banking fees & interest',icon:'Landmark',      target:400, color:'#57534e'},
  {id:'phone',        label:'Cell phone',            icon:'Smartphone',     target:45,  color:'#0891b2'},
  {id:'cleaning',     label:'Cleaning services',     icon:'Brush',          target:25,  color:'#0d9488'},
  {id:'clothing',     label:'Clothing',              icon:'Shirt',          target:50,  color:'#b45309'},
  {id:'cc_payment',   label:'Credit card payment',   icon:'CreditCard',     target:0,   color:'#57534e', excluded:true},
  {id:'electricity',  label:'Electricity',           icon:'Zap',            target:150, color:'#ca8a04'},
  {id:'entertainment',label:'Entertainment',         icon:'Ticket',         target:100, color:'#065f46'},
  {id:'gifts',        label:'Gifts',                 icon:'Gift',           target:25,  color:'#db2777'},
  {id:'hobbies',      label:'Golf & hobbies',        icon:'Dumbbell',       target:130, color:'#4f46e5'},
  {id:'groceries',    label:'Groceries',             icon:'ShoppingBasket', target:500, color:'#1a7a4a'},
  {id:'income',       label:'Income',                icon:'Leaf',           target:0,   color:'#1a7a4a', excluded:true, isIncome:true},
  {id:'legal',        label:'Legal & professional',  icon:'Scale',          target:125, color:'#78716c'},
  {id:'medical',      label:'Medical & dental',      icon:'Stethoscope',    target:600, color:'#c0392b'},
  {id:'other',        label:'Other / uncategorised', icon:'Package',        target:200, color:'#6b7280'},
  {id:'pharmacy',     label:'Pharmacy',              icon:'Pill',           target:200, color:'#be185d'},
  {id:'rent',         label:'Rent + home',           icon:'Home',           target:1900,color:'#92400e'},
  {id:'rental_insurance',label:'Rental insurance',   icon:'Shield',         target:67,  color:'#1d4ed8'},
  {id:'restaurant',   label:'Restaurant & takeout',  icon:'Utensils',       target:500, color:'#1d4ed8'},
  {id:'salon',        label:'Salon & spa',           icon:'Scissors',       target:50,  color:'#9d174d'},
  {id:'subscriptions',label:'Subscriptions',         icon:'Music',          target:120, color:'#0369a1'},
  {id:'transfer',     label:'Transfers',             icon:'ArrowLeftRight', target:0,   color:'#78716c', excluded:true},
  {id:'transit',      label:'Transit (Presto)',      icon:'Train',          target:50,  color:'#0369a1'},
  {id:'travel',       label:'Travel',                icon:'Plane',          target:250, color:'#0e7490'},
  {id:'uber',         label:'Uber & taxis',          icon:'Car',            target:150, color:'#b45309'},
];
const COLOR_SWATCHES = ['#1a7a4a','#1d4ed8','#7c3aed','#b45309','#0369a1',
  '#be185d','#c0392b','#065f46','#4f46e5','#0891b2','#9d174d','#57534e','#6b7280'];
const ICON_MAP = {
  ShoppingBasket,Utensils,Wine,Car,Train,Pill,Stethoscope,Ticket,Code2,CreditCard,
  Shirt,Plane,Scissors,Scale,Package,Tag,Coffee,Music,BookOpen,Camera,Dumbbell,Leaf,PawPrint,Brush,Baby,
  Landmark,Smartphone,Zap,Gift,Shield,ArrowLeftRight,Home,
};
const PICKABLE_ICONS = Object.keys(ICON_MAP);


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
export function ProcessingModal({stage, fileName, rowCount, aiCount}) {
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
export function AuthScreen({onAuth}) {
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
export function AddCatModal({onSave,onClose}) {
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
export function OtherReviewModal({ items, allCats, onSave, onClose, onDeleteRow }) {
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
                      {tx.date} · {instLabel(tx.source)}
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
                    onChange={e => {
                      if (e.target.value === '__delete') { onDeleteRow?.(tx); return; }
                      edit(tx.id, { category: e.target.value });
                    }}
                    style={{ width:'100%', border:`1.5px solid ${isOther?C.amber:cat.color}`,
                      borderRadius:9, padding:'8px 10px', fontSize:13, fontWeight:600,
                      color:isOther?C.amber:cat.color, background:C.white,
                      fontFamily:SANS, cursor:'pointer', outline:'none' }}>
                    {allCats.map(c => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                    <option disabled>──────────</option>
                    <option value="__delete">Delete — this is a duplicate</option>
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
export function HomeTab({txns,bankImports,ccTarget,setCcTarget,
                  allCats,onSaveSettings,catTargets,suggested,onAcceptSuggested,
                  onAddCat,onDeleteCat,profile,onReviewOther,otherCount,
                  onChangeCategory,view,setView,history,billRules,
                  onDeleteRow,duplicateCount,onReviewDuplicates}) {
  const [openCat, setOpenCat] = useState(null);   // which category is expanded
  const [busyId,  setBusyId]  = useState(null);   // row currently saving
  const me=firstName(profile?.name);
  const everything=[...txns,...bankImports];
  const everythingThisMonth=everything;   // both people, before the view filter

  // Recurring charges are worked out from your own history rather than kept in
  // a hardcoded list. Only what has NOT yet been charged counts as committed —
  // anything already charged is sitting in `spent`, and adding both double counts.
  const recurring   = applyBillRules(detectRecurring(history || []), billRules || [])
    .filter(b => b.confidence === 'high');
  const { paid:paidBills, due:dueBills, dueTotal } = splitRecurring(recurring, everythingThisMonth);

  // Same logic for the card payment: only pledge it if it hasn't gone out yet
  const ccPaidThisMonth = everythingThisMonth
    .filter(t=>(t.category||t.cat)==='cc_payment')
    .reduce((a,t)=>a+t.amount,0);
  const ccStillDue = Math.max(0, ccTarget - ccPaidThisMonth);

  const committed = dueTotal + ccStillDue;


  // "Mine" shows only your own transactions. "Combined" shows the household.
  const allTx = view==='mine'
    ? everything.filter(t=>!firstName(t.who)||firstName(t.who)===me)
    : everything;

  const excludedIds=new Set(allCats.filter(c=>c.excluded).map(c=>c.id));

  // Income is no longer typed in — it is read off the statements
  const incomeRows=allTx.filter(t=>(t.category||t.cat)==='income');
  const totalIncome=incomeRows.reduce((a,t)=>a+t.amount,0);

  // Who contributed what, derived rather than declared
  const incomeByPerson={};
  incomeRows.forEach(t=>{
    const k=firstName(t.who)||'unattributed';
    incomeByPerson[k]=(incomeByPerson[k]||0)+t.amount;
  });
  const txByCat={};
  allTx.forEach(t=>{const k=t.category||t.cat;if(k&&k!=='_skip')txByCat[k]=(txByCat[k]||0)+t.amount;});
  // Money moved between accounts is tracked but never counted as spending
  const totalSpent=Object.entries(txByCat)
    .filter(([k])=>!excludedIds.has(k))
    .reduce((a,[,v])=>a+v,0);

  // Same merchant, same day, both of you → you were out together
  const { shared:sharedMoments } = findSharedMoments(allTx);
  const together = summariseTogether(sharedMoments);

  // Every transaction belonging to one category, newest first
  const rowsFor=catId=>allTx
    .filter(t=>(t.category||t.cat)===catId)
    .sort((a,b)=>new Date(b.date)-new Date(a.date));

  async function reassign(tx,newCat){
    setBusyId(tx.id);
    await onChangeCategory(tx, newCat);
    setBusyId(null);
  }
  const surplus=totalIncome-committed-totalSpent;
  const [showAdd,setShowAdd]=useState(false);

  // Show the user's financial goal prominently if set
  const goal=profile?.goal;

  return (
    <div style={{padding:'16px 16px 0'}}>
      {/* Whose money are we looking at */}
      <div style={{display:'flex',background:C.sandMid,borderRadius:12,padding:3,
        marginBottom:12}}>
        {[['mine','Just me'],['combined','Combined']].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{flex:1,border:'none',
            borderRadius:9,padding:'8px 0',fontSize:13,fontWeight:600,cursor:'pointer',
            fontFamily:SANS,background:view===k?C.white:'transparent',
            color:view===k?C.ink:C.inkSoft,
            boxShadow:view===k?'0 1px 3px rgba(0,0,0,0.1)':'none',
            display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
            {k==='combined'&&<Heart size={12} color={view===k?'#be185d':C.inkSoft}
              fill={view===k?'#be185d':'none'}/>}
            {l}
          </button>
        ))}
      </div>

      {/* Hero */}
      <Card style={{background:C.green,padding:'20px 20px'}}>
        <p style={{fontSize:11,color:'rgba(255,255,255,0.7)',textTransform:'uppercase',
          letterSpacing:'0.1em',margin:'0 0 4px',fontFamily:SANS}}>
          {view==='combined'?'Available to the two of you':'Available to you'}
        </p>
        <p style={{fontFamily:SERIF,fontSize:44,fontWeight:600,color:'#fff',margin:'0 0 16px',
          letterSpacing:'-0.02em',lineHeight:1}}>
          {surplus>=0?fmt(surplus):'–'+fmt(Math.abs(surplus))}
        </p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
          {[['Income',fmt(totalIncome),null],
            ['Still to come',fmt(committed),dueBills.length],
            ['Spent',fmt(totalSpent),null]].map(([l,v,n])=>(
            <div key={l}>
              <p style={{margin:0,fontSize:11,color:'rgba(255,255,255,0.65)',
                textTransform:'uppercase',letterSpacing:'0.08em',fontFamily:SANS}}>{l}</p>
              <p style={{margin:0,fontFamily:SERIF,fontSize:18,fontWeight:600,
                color:'rgba(255,255,255,0.95)'}}>{v}</p>
              {n!=null&&n>0&&(
                <p style={{margin:0,fontSize:10,color:'rgba(255,255,255,0.55)',fontFamily:SANS}}>
                  {n} bill{n===1?'':'s'} not yet charged
                </p>
              )}
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
              onChange={e=>{const v=parseFloat(e.target.value)||0;setCcTarget(v);onSaveSettings(v);}}
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

      {/* Duplicates found in what is already saved */}
      {duplicateCount > 0 && (
        <button onClick={onReviewDuplicates} style={{ width:'100%', border:`1.5px solid ${C.red}`,
          borderRadius:14, padding:'12px 16px', marginBottom:12, background:C.redLight,
          cursor:'pointer', textAlign:'left', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:10, background:C.red+'22',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <Trash2 size={17} color={C.red}/>
          </div>
          <div style={{ flex:1 }}>
            <p style={{ margin:0, fontSize:13, fontWeight:700, color:C.red, fontFamily:SANS }}>
              {duplicateCount} duplicate{duplicateCount>1?'s':''} in this month
            </p>
            <p style={{ margin:'2px 0 0', fontSize:12, color:'#9b2c2c', fontFamily:SANS }}>
              The same purchase is recorded more than once, so your totals are too high.
            </p>
          </div>
          <ChevronRight size={18} color={C.red}/>
        </button>
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

      {/* Time spent together — same place, same day, both of you */}
      {together.count>0&&(
        <div style={{background:'#fdf2f8',border:'1px solid #f9a8d4',borderRadius:14,
          padding:'14px 16px',marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:together.list.length?9:0}}>
            <div style={{width:30,height:30,borderRadius:99,background:'#be185d',
              display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <Heart size={15} color="#fff" fill="#fff"/>
            </div>
            <div style={{flex:1}}>
              <p style={{margin:0,fontSize:14,fontWeight:700,color:'#be185d',fontFamily:SANS}}>
                {together.count} {together.count===1?'outing':'outings'} together
              </p>
              <p style={{margin:'2px 0 0',fontSize:12,color:'#9d174d',fontFamily:SANS}}>
                {fmt(together.total)} spent side by side this month
              </p>
            </div>
          </div>
          {together.list.slice(0,4).map((o,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',gap:8,
              padding:'6px 0 0',borderTop:i?'1px solid #f9a8d4':'none',
              marginTop:i?6:0}}>
              <Heart size={10} color="#be185d" fill="#be185d" style={{flexShrink:0}}/>
              <span style={{flex:1,fontSize:12,color:'#831843',fontFamily:SANS,
                overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {o.merchant}
              </span>
              <span style={{fontSize:10,color:'#be185d',fontFamily:SANS}}>{o.date}</span>
              <span style={{fontFamily:SERIF,fontSize:14,fontWeight:600,color:'#831843'}}>
                {fmt(o.total)}
              </span>
            </div>
          ))}
          {together.list.length>4&&(
            <p style={{margin:'8px 0 0',fontSize:11,color:'#be185d',fontFamily:SANS}}>
              +{together.list.length-4} more
            </p>
          )}
        </div>
      )}

      {(dueBills.length>0||paidBills.length>0)&&(
        <Card style={{padding:'8px 0'}}>
          <button onClick={()=>setOpenCat(openCat==='__bills'?null:'__bills')}
            style={{display:'flex',alignItems:'center',gap:10,padding:'10px 18px',
              width:'100%',border:'none',background:'none',cursor:'pointer',textAlign:'left'}}>
            <div style={{width:30,height:30,borderRadius:9,background:C.blue+'18',
              display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <CalendarDays size={15} color={C.blue}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <p style={{margin:0,fontSize:13,fontWeight:600,color:C.ink,fontFamily:SANS}}>
                Recurring charges
              </p>
              <p style={{margin:'1px 0 0',fontSize:11,color:C.inkSoft,fontFamily:SANS}}>
                {paidBills.length} already charged · {dueBills.length} still to come
              </p>
            </div>
            <span style={{fontFamily:SERIF,fontSize:16,fontWeight:600,color:C.ink}}>
              {fmt(dueTotal)}
            </span>
            <ChevronRight size={14} color={C.sandDark}
              style={{transform:openCat==='__bills'?'rotate(90deg)':'none',
                transition:'transform 0.15s'}}/>
          </button>

          {openCat==='__bills'&&(
            <div style={{background:C.sand,padding:'6px 0 10px'}}>
              <p style={{margin:'0 18px 6px',fontSize:10,color:C.inkSoft,
                fontFamily:SANS,lineHeight:1.6}}>
                Worked out from your own statements — anything charged in at least two
                different months for a steady amount. Only the ones that haven't been
                charged yet count towards "still to come".
              </p>
              {dueBills.map(b=>(
                <div key={b.key} style={{display:'flex',alignItems:'center',gap:8,
                  padding:'7px 18px 7px 30px'}}>
                  <div style={{width:6,height:6,borderRadius:99,background:C.blue,flexShrink:0}}/>
                  <span style={{flex:1,fontSize:12,color:C.ink,fontFamily:SANS,
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {b.label}
                  </span>
                  <span style={{fontSize:10,color:C.inkSoft,fontFamily:SANS}}>
                    ~{b.day}{b.day===1?'st':b.day===2?'nd':b.day===3?'rd':'th'}
                  </span>
                  <span style={{fontFamily:SERIF,fontSize:14,fontWeight:600,color:C.ink,
                    minWidth:56,textAlign:'right'}}>{fmt(b.amount)}</span>
                </div>
              ))}
              {paidBills.map(b=>(
                <div key={b.key} style={{display:'flex',alignItems:'center',gap:8,
                  padding:'7px 18px 7px 30px',opacity:0.5}}>
                  <Check size={11} color={C.green} strokeWidth={3} style={{flexShrink:0}}/>
                  <span style={{flex:1,fontSize:12,color:C.inkMid,fontFamily:SANS,
                    textDecoration:'line-through',
                    overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {b.label}
                  </span>
                  <span style={{fontSize:10,color:C.green,fontFamily:SANS}}>charged</span>
                  <span style={{fontFamily:SERIF,fontSize:14,fontWeight:600,color:C.inkSoft,
                    minWidth:56,textAlign:'right'}}>{fmt(b.amount)}</span>
                </div>
              ))}
              {recurring.length===0&&(
                <p style={{margin:'0 18px',fontSize:12,color:C.inkSoft,
                  fontFamily:SANS,fontStyle:'italic'}}>
                  Not enough history yet. Upload two or more months and your recurring
                  bills will be spotted automatically.
                </p>
              )}
            </div>
          )}
        </Card>
      )}

      <SL>Spending this month</SL>
      <Card style={{padding:'8px 0'}}>
        {allCats.map((cat,i)=>{
          const spent=txByCat[cat.id]||0;
          const target=catTargets[cat.id]||cat.target;
          const over=spent>target&&target>0;
          const isOpen=openCat===cat.id;
          const rows=isOpen?rowsFor(cat.id):[];
          return (
            <div key={cat.id}>
              {i>0&&<Divider/>}

              {/* Tap the row to see what makes up the total */}
              <button
                onClick={()=>setOpenCat(isOpen?null:cat.id)}
                style={{display:'flex',alignItems:'center',gap:12,padding:'11px 18px',
                  width:'100%',border:'none',background:isOpen?C.sand:'transparent',
                  cursor:'pointer',textAlign:'left'}}>
                <div style={{width:32,height:32,borderRadius:9,background:cat.color+'18',
                  display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  <CatIcon name={cat.icon} size={16} color={cat.color}/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:14,color:C.ink,fontFamily:SANS,
                      fontWeight:spent>0?500:400,display:'flex',alignItems:'center',gap:6}}>
                      {cat.label}
                      {cat.excluded&&(
                        <span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:99,
                          background:C.sandMid,color:C.inkSoft,letterSpacing:'0.04em'}}>
                          NOT SPENDING
                        </span>
                      )}
                    </span>
                    <div style={{display:'flex',alignItems:'baseline',gap:4}}>
                      <span style={{fontFamily:SERIF,fontSize:17,fontWeight:600,
                        color:over?C.red:spent>0?C.ink:C.sandDark}}>{fmt(spent)}</span>
                      {target>0&&<span style={{fontSize:11,color:C.inkSoft,fontFamily:SANS}}>{fmtK(target)}</span>}
                      <ChevronRight size={14} color={C.sandDark}
                        style={{transform:isOpen?'rotate(90deg)':'none',
                          transition:'transform 0.15s',marginLeft:2}}/>
                    </div>
                  </div>
                  {target>0&&<Bar spent={spent} target={target} color={cat.color}/>}
                  {over&&<p style={{margin:'3px 0 0',fontSize:10,color:C.red,fontFamily:SANS}}>
                    {fmt(spent-target)} over</p>}
                </div>
              </button>

              {/* Drill-down: every transaction in this category */}
              {isOpen&&(
                <div style={{background:C.sand,padding:'2px 0 10px'}}>
                  {rows.length===0?(
                    <p style={{margin:0,padding:'10px 18px',fontSize:12,
                      color:C.inkSoft,fontFamily:SANS,fontStyle:'italic'}}>
                      Nothing in this category yet this month.
                    </p>
                  ):rows.map(tx=>(
                    <div key={tx.id} style={{display:'flex',alignItems:'center',gap:8,
                      padding:'8px 18px 8px 30px',opacity:busyId===tx.id?0.45:1}}>
                      <div style={{flex:1,minWidth:0}}>
                        <p style={{margin:0,fontSize:12,color:C.ink,fontFamily:SANS,
                          overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                          display:'flex',alignItems:'center',gap:5}}>
                          {sharedMoments.has(tx.id)&&(
                            <Heart size={11} color="#be185d" fill="#be185d"
                              style={{flexShrink:0}}/>
                          )}
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',
                            whiteSpace:'nowrap'}}>
                            {tx.note||tx.description||cat.label}
                          </span>
                        </p>
                        <p style={{margin:'1px 0 0',fontSize:10,fontFamily:SANS,
                          color:sharedMoments.has(tx.id)?'#be185d':C.inkSoft}}>
                          {tx.date}{tx.source?' · '+instLabel(tx.source):''}
                          {tx.who?' · '+tx.who:''}
                          {sharedMoments.has(tx.id)&&
                            ` · together with ${sharedMoments.get(tx.id).partner}`}
                        </p>
                      </div>
                      <p style={{margin:0,fontFamily:SERIF,fontSize:14,fontWeight:600,
                        color:C.ink,minWidth:56,textAlign:'right'}}>{fmt(tx.amount)}</p>
                      {busyId===tx.id
                        ? <Spinner size={13}/>
                        : (
                          <select
                            value={cat.id}
                            onChange={e=>{
                              if(e.target.value==='__delete'){ onDeleteRow?.(tx); return; }
                              if(e.target.value!==cat.id) reassign(tx,e.target.value);
                            }}
                            style={{border:`1px solid ${C.sandDark}`,borderRadius:7,
                              padding:'3px 5px',fontSize:10,fontWeight:600,color:C.inkMid,
                              background:C.white,cursor:'pointer',fontFamily:SANS,maxWidth:104}}>
                            {allCats.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
                            <option disabled>──────────</option>
                            <option value="__delete">Delete — duplicate</option>
                          </select>
                        )}
                    </div>
                  ))}
                  {rows.length>0&&(
                    <p style={{margin:'6px 18px 0 30px',fontSize:10,color:C.inkSoft,
                      fontFamily:SANS,lineHeight:1.5}}>
                      Change any dropdown to move that transaction to another category.
                    </p>
                  )}
                  {cat.custom&&(
                    <button
                      onClick={()=>{if(window.confirm(`Remove the "${cat.label}" category?`)){
                        setOpenCat(null); onDeleteCat(cat.id);}}}
                      style={{display:'flex',alignItems:'center',gap:6,margin:'10px 18px 0 30px',
                        border:`1px solid ${C.red}44`,borderRadius:8,padding:'5px 10px',
                        background:C.white,cursor:'pointer',fontFamily:SANS,
                        fontSize:11,fontWeight:600,color:C.red}}>
                      <Trash2 size={12} color={C.red}/> Remove this category
                    </button>
                  )}
                </div>
              )}
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
        {incomeRows.length===0?(
          <div style={{padding:'16px 18px'}}>
            <p style={{margin:'0 0 4px',fontSize:13,color:C.inkMid,fontFamily:SANS}}>
              No income recorded yet this month.
            </p>
            <p style={{margin:0,fontSize:12,color:C.inkSoft,fontFamily:SANS,lineHeight:1.6}}>
              Income is read straight off your statements. Upload a statement that
              includes a deposit and it will appear here automatically — no need to
              type in what anyone contributed.
            </p>
          </div>
        ):(
          <>
            {Object.entries(incomeByPerson)
              .sort((a,b)=>b[1]-a[1])
              .map(([person,amt],i)=>(
              <div key={person}>
                {i>0&&<Divider/>}
                <div style={{display:'flex',alignItems:'center',gap:12,padding:'11px 18px'}}>
                  <UserAvatar name={person} size={30}/>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{margin:0,fontSize:14,color:C.ink,fontFamily:SANS,
                      textTransform:'capitalize'}}>{person}</p>
                    <p style={{margin:'1px 0 0',fontSize:11,color:C.inkSoft,fontFamily:SANS}}>
                      {incomeRows.filter(t=>(firstName(t.who)||'unattributed')===person).length}{' '}
                      deposit{incomeRows.filter(t=>(firstName(t.who)||'unattributed')===person).length===1?'':'s'}
                    </p>
                  </div>
                  <p style={{margin:0,fontFamily:SERIF,fontSize:18,fontWeight:600,color:C.green}}>
                    {fmt(amt)}
                  </p>
                </div>
              </div>
            ))}
            <Divider/>
            <button onClick={()=>setOpenCat(openCat==='income'?null:'income')}
              style={{display:'flex',alignItems:'center',gap:8,padding:'10px 18px',
                width:'100%',border:'none',background:'none',cursor:'pointer'}}>
              <span style={{flex:1,textAlign:'left',fontSize:12,color:C.inkSoft,fontFamily:SANS}}>
                {openCat==='income'?'Hide deposits':'Show every deposit'}
              </span>
              <ChevronRight size={14} color={C.sandDark}
                style={{transform:openCat==='income'?'rotate(90deg)':'none',
                  transition:'transform 0.15s'}}/>
            </button>
            {openCat==='income'&&(
              <div style={{background:C.sand,padding:'2px 0 8px'}}>
                {rowsFor('income').map(tx=>(
                  <div key={tx.id} style={{display:'flex',alignItems:'center',gap:8,
                    padding:'8px 18px 8px 30px',opacity:busyId===tx.id?0.45:1}}>
                    <div style={{flex:1,minWidth:0}}>
                      <p style={{margin:0,fontSize:12,color:C.ink,fontFamily:SANS,
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {tx.note||tx.description||'Deposit'}
                      </p>
                      <p style={{margin:'1px 0 0',fontSize:10,color:C.inkSoft,fontFamily:SANS}}>
                        {tx.date}{tx.source?' · '+instLabel(tx.source):''}
                        {tx.who?' · '+tx.who:''}
                      </p>
                    </div>
                    <p style={{margin:0,fontFamily:SERIF,fontSize:14,fontWeight:600,
                      color:C.green,minWidth:56,textAlign:'right'}}>{fmt(tx.amount)}</p>
                    {busyId===tx.id?<Spinner size={13}/>:(
                      <select value="income"
                        onChange={e=>{if(e.target.value!=='income')reassign(tx,e.target.value);}}
                        style={{border:`1px solid ${C.sandDark}`,borderRadius:7,
                          padding:'3px 5px',fontSize:10,fontWeight:600,color:C.inkMid,
                          background:C.white,cursor:'pointer',fontFamily:SANS,maxWidth:104}}>
                        {allCats.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    )}
                  </div>
                ))}
                <p style={{margin:'6px 18px 0 30px',fontSize:10,color:C.inkSoft,
                  fontFamily:SANS,lineHeight:1.5}}>
                  Something in here that isn't really income? Change its category and it
                  moves out.
                </p>
              </div>
            )}
          </>
        )}
      </Card>

      {showAdd&&<AddCatModal onSave={cat=>{onAddCat(cat);setShowAdd(false);}} onClose={()=>setShowAdd(false)}/>}
    </div>
  );
}

// ─── ADD TAB ──────────────────────────────────────────────────────────────────
export function AddTab({profile,allCats,onAdd}) {
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
export function HistoryTab({txns,bankImports,allCats,onDeleteTxn,onDeleteImport,onSaveNote}) {
  const { shared:sharedMoments } = findSharedMoments([...txns,...bankImports]);
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
                        display:'flex',alignItems:'center',gap:5,minWidth:0}}>
                        {sharedMoments.has(tx.id)&&(
                          <Heart size={12} color="#be185d" fill="#be185d" style={{flexShrink:0}}/>
                        )}
                        <span style={{overflow:'hidden',textOverflow:'ellipsis',
                          whiteSpace:'nowrap'}}>
                          {tx.note||tx.description||c.label}
                        </span></p>
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
                                  ? `${instLabel(tx.source)} · tap to add note`
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

// ─── Bill editor ──────────────────────────────────────────────────────────────
export function BillEditModal({ bill, allCats, onSave, onDelete, onClose }) {
  const [label,  setLabel]  = useState(bill?.label || '');
  const [amount, setAmount] = useState(bill?.amount ?? '');
  const [day,    setDay]    = useState(bill?.day ?? 1);
  const [cat,    setCat]    = useState(bill?.category || 'other');
  const [busy,   setBusy]   = useState(false);

  const isNew = !bill;
  const valid = label.trim() && Number(amount) > 0 && day >= 1 && day <= 31;

  async function save() {
    if (!valid) return;
    setBusy(true);
    await onSave({
      key:      bill?.key || 'manual:' + uid(),
      label:    label.trim(),
      amount:   Number(amount),
      day:      Number(day),
      category: cat,
      status:   bill?.detected ? 'confirmed' : 'manual',
    });
    setBusy(false);
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:760,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>
      <div style={{ position:'relative', background:C.white, borderRadius:'20px 20px 0 0',
        padding:'22px 20px 34px', animation:'slideUp 0.25s ease', maxHeight:'88dvh', overflowY:'auto' }}>

        <div style={{ display:'flex', alignItems:'center', marginBottom:16 }}>
          <h2 style={{ flex:1, margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
            {isNew ? 'Add a bill' : 'Edit bill'}
          </h2>
          <button onClick={onClose} style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        {bill?.detected && (
          <p style={{ margin:'0 0 14px', fontSize:12, color:C.inkSoft,
            fontFamily:SANS, lineHeight:1.6 }}>
            Found in {bill.monthsSeen} months of statements. Anything you change here
            sticks, and future imports will not overwrite it.
          </p>
        )}

        <SL>Name</SL>
        <input value={label} onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Rent"
          style={{ width:'100%', border:`1px solid ${C.sandDark}`, borderRadius:10,
            padding:'12px 14px', fontSize:16, color:C.ink, background:C.sand,
            marginBottom:14, outline:'none', fontFamily:SANS, boxSizing:'border-box' }}/>

        <SL>Amount</SL>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
          <span style={{ fontSize:18, color:C.inkSoft, fontFamily:SERIF }}>$</span>
          <input type="number" inputMode="decimal" value={amount}
            onChange={e => setAmount(e.target.value)}
            style={{ flex:1, border:`1px solid ${C.sandDark}`, borderRadius:10,
              padding:'12px 14px', fontSize:16, color:C.ink, background:C.sand,
              outline:'none', fontFamily:SERIF, boxSizing:'border-box' }}/>
        </div>

        <SL>Usually charged on the</SL>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <input type="number" min="1" max="31" value={day}
            onChange={e => setDay(e.target.value)}
            style={{ width:80, border:`1px solid ${C.sandDark}`, borderRadius:10,
              padding:'12px 14px', fontSize:16, color:C.ink, background:C.sand,
              outline:'none', fontFamily:SERIF, boxSizing:'border-box' }}/>
          <span style={{ fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
            of the month · the 31st falls back to the last day in shorter months
          </span>
        </div>

        <SL>Category</SL>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:7, marginBottom:20 }}>
          {allCats.filter(c => !c.isIncome).map(c => (
            <button key={c.id} onClick={() => setCat(c.id)}
              style={{ border:`1.5px solid ${cat===c.id ? c.color : C.sandDark}`,
                borderRadius:10, padding:'9px 6px', cursor:'pointer',
                background: cat===c.id ? c.color+'15' : C.white,
                display:'flex', flexDirection:'column', alignItems:'center', gap:5 }}>
              <CatIcon name={c.icon} size={16} color={cat===c.id ? c.color : C.inkSoft}/>
              <span style={{ fontSize:10, color:cat===c.id ? c.color : C.inkMid,
                fontFamily:SANS, textAlign:'center', lineHeight:1.2 }}>{c.label}</span>
            </button>
          ))}
        </div>

        <button onClick={save} disabled={!valid || busy}
          style={{ width:'100%', border:'none', padding:'15px', borderRadius:12,
            background: valid ? C.green : C.sandDark, color: valid ? '#fff' : C.inkSoft,
            fontSize:15, fontWeight:600, cursor: valid ? 'pointer' : 'default',
            fontFamily:SANS, marginBottom:8,
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          {busy ? <><Spinner size={14}/>Saving…</> : isNew ? 'Add bill' : 'Save changes'}
        </button>

        {bill && (
          <button onClick={() => onDelete(bill)}
            style={{ width:'100%', border:`1px solid ${C.red}44`, padding:'13px',
              borderRadius:12, background:C.white, color:C.red, fontSize:14,
              fontWeight:600, cursor:'pointer', fontFamily:SANS }}>
            {bill.manual ? 'Delete this bill' : 'Not a bill — hide it'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── BILLS TAB ────────────────────────────────────────────────────────────────
export function BillsTab({history, txns, bankImports, allCats, year, month,
                          billRules, onSaveRule, onDeleteRule, showToast, billsLocal}) {
  const [editing, setEditing] = useState(undefined);   // undefined = closed, null = new

  const detected = detectRecurring(history || []);
  const bills    = applyBillRules(detected, billRules || []);

  const confirmed  = bills.filter(b => b.confidence === 'high');
  const suggested  = bills.filter(b => b.confidence !== 'high');
  const sched      = buildSchedule(confirmed, [...txns, ...bankImports], year, month);
  const weekTotal  = sched.dueThisWeek.reduce((a, e) => a + e.amount, 0);

  async function saveRule(rule) { await onSaveRule(rule); setEditing(undefined); }
  async function removeRule(bill) {
    await onSaveRule({ key: bill.key, status: 'hidden', label: bill.label });
    setEditing(undefined);
    showToast(bill.manual ? 'Bill deleted' : 'Hidden from bills');
  }

  const STATUS = {
    overdue: { label:'OVERDUE',  color:C.red   },
    due:     { label:'UPCOMING', color:C.blue  },
    paid:    { label:'CHARGED',  color:C.green },
  };

  const Row = ({ e, onTap }) => {
    const c    = allCats.find(x => x.id === e.category) || { icon:'Package', color:C.inkSoft };
    const st   = STATUS[e.status] || STATUS.due;
    const done = e.status === 'paid';
    return (
      <button onClick={onTap} style={{ display:'flex', alignItems:'center', gap:11,
        padding:'12px 18px', width:'100%', border:'none', background:'none',
        cursor:'pointer', textAlign:'left' }}>
        <div style={{ width:34, height:34, borderRadius:10, background:c.color+'18',
          display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          opacity: done ? 0.5 : 1 }}>
          <CatIcon name={c.icon} size={16} color={c.color}/>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <p style={{ margin:0, fontSize:14, fontFamily:SANS,
            color: done ? C.inkSoft : C.ink,
            textDecoration: done ? 'line-through' : 'none',
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {e.label}
            {e.edited && <span style={{ marginLeft:6, fontSize:9, fontWeight:700,
              color:C.inkSoft, letterSpacing:'0.04em' }}>EDITED</span>}
          </p>
          <p style={{ margin:'2px 0 0', fontSize:11, fontFamily:SANS,
            color: e.status === 'overdue' ? C.red : C.inkSoft }}>
            {e.date
              ? e.date.toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric' })
              : `around the ${e.day}${e.day===1?'st':e.day===2?'nd':e.day===3?'rd':'th'}`}
            {e.viewingCurrentMonth && e.daysAway != null ? ' · ' + relativeDay(e.daysAway) : ''}
            {e.varies ? ' · varies' : ''}
          </p>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <p style={{ margin:0, fontFamily:SERIF, fontSize:17, fontWeight:600,
            color: done ? C.inkSoft : C.ink }}>{fmt(e.amount)}</p>
          <span style={{ fontSize:9, fontWeight:700, letterSpacing:'0.06em',
            color:st.color, fontFamily:SANS }}>{st.label}</span>
        </div>
        <ChevronRight size={14} color={C.sandDark} style={{ flexShrink:0 }}/>
      </button>
    );
  };

  const Section = ({ title, items, note }) => items.length === 0 ? null : (
    <>
      <SL>{title}</SL>
      {note && <p style={{ margin:'-4px 2px 8px', fontSize:11, color:C.inkSoft,
        fontFamily:SANS, lineHeight:1.6 }}>{note}</p>}
      <Card style={{ padding:'4px 0' }}>
        {items.map((e, i) => (
          <div key={e.key}>{i > 0 && <Divider/>}
            <Row e={e} onTap={() => setEditing(e)}/>
          </div>
        ))}
      </Card>
    </>
  );

  const AddButton = () => (
    <button onClick={() => setEditing(null)}
      style={{ width:'100%', border:`1.5px dashed ${C.sandDark}`, borderRadius:12,
        padding:'13px', background:'none', cursor:'pointer', fontFamily:SANS,
        fontSize:14, fontWeight:600, color:C.inkSoft, marginBottom:16,
        display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
      <Plus size={15} color={C.inkSoft}/> Add a bill manually
    </button>
  );

  return (
    <div style={{ padding:'16px 16px 0' }}>
      <Card style={{ background:C.green, padding:'20px 20px' }}>
        <p style={{ fontSize:11, color:'rgba(255,255,255,0.7)', textTransform:'uppercase',
          letterSpacing:'0.1em', margin:'0 0 4px', fontFamily:SANS }}>
          Still to be paid in {MONTHS[month]}
        </p>
        <p style={{ fontFamily:SERIF, fontSize:40, fontWeight:600, color:'#fff',
          margin:'0 0 14px', letterSpacing:'-0.02em', lineHeight:1 }}>
          {fmt(sched.outstandingTotal)}
        </p>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
          {[['Next 7 days', fmt(weekTotal)],
            ['Already paid', fmt(sched.paidTotal)],
            ['Whole month', fmt(sched.monthTotal)]].map(([l, v]) => (
            <div key={l}>
              <p style={{ margin:0, fontSize:10, color:'rgba(255,255,255,0.65)',
                textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:SANS }}>{l}</p>
              <p style={{ margin:0, fontFamily:SERIF, fontSize:17, fontWeight:600,
                color:'rgba(255,255,255,0.95)' }}>{v}</p>
            </div>
          ))}
        </div>
      </Card>

      {billsLocal && (
        <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:14,
          padding:'12px 16px', marginBottom:12 }}>
          <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:700,
            color:C.amber, fontFamily:SANS }}>
            Bill edits are saved on this device only
          </p>
          <p style={{ margin:'0 0 8px', fontSize:12, color:'#92400e',
            fontFamily:SANS, lineHeight:1.6 }}>
            Everything here works, but your partner will not see these changes until
            the table exists. Run this once in Supabase → SQL Editor, then reload —
            anything you have already saved is uploaded automatically.
          </p>
          <pre style={{ margin:0, background:'rgba(0,0,0,0.06)', borderRadius:8,
            padding:'10px 12px', fontSize:10, lineHeight:1.6, color:'#92400e',
            overflowX:'auto', fontFamily:'monospace' }}>{`create table if not exists bill_rules (
  key text primary key, label text, amount numeric,
  day int, category text,
  status text default 'auto',
  updated_at timestamptz default now()
);
alter table bill_rules enable row level security;
create policy "allow all on bill_rules" on bill_rules
  for all using (true) with check (true);`}</pre>
        </div>
      )}

      {sched.overdue.length > 0 && (
        <div style={{ background:C.redLight, border:`1px solid ${C.red}33`, borderRadius:14,
          padding:'12px 16px', marginBottom:12, display:'flex', gap:10, alignItems:'flex-start' }}>
          <AlertCircle size={17} color={C.red} style={{ flexShrink:0, marginTop:1 }}/>
          <p style={{ margin:0, fontSize:12, color:'#9b2c2c', fontFamily:SANS, lineHeight:1.6 }}>
            <b style={{ color:C.red }}>
              {sched.overdue.length} bill{sched.overdue.length === 1 ? '' : 's'} past the usual date.
            </b>{' '}
            Either the charge is late, or the statement covering it has not been uploaded yet.
          </p>
        </div>
      )}

      <Section title="Past the usual date"
        items={sched.entries.filter(e => e.status === 'overdue')}/>
      <Section title="Coming up"
        items={sched.entries.filter(e => e.status === 'due')}
        note={weekTotal > 0 ? `${fmt(weekTotal)} of this lands within seven days.` : null}/>
      <Section title="Already charged this month"
        items={sched.entries.filter(e => e.status === 'paid')}/>

      {confirmed.length === 0 && (
        <Card style={{ textAlign:'center', padding:'32px 24px' }}>
          <CalendarDays size={36} color={C.sandDark} style={{ marginBottom:10 }}/>
          <p style={{ fontFamily:SERIF, fontSize:19, color:C.inkMid, margin:'0 0 6px' }}>
            No bills yet
          </p>
          <p style={{ fontSize:13, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6, margin:0 }}>
            Upload two or more months and anything charged regularly appears here on
            its own. You can also add a bill by hand.
          </p>
        </Card>
      )}

      <AddButton/>

      {suggested.length > 0 && (
        <>
          <SL>Might be bills</SL>
          <p style={{ margin:'-4px 2px 8px', fontSize:11, color:C.inkSoft,
            fontFamily:SANS, lineHeight:1.6 }}>
            These repeat month to month but the amount or date moves around, so they
            could equally be a shop you visit often. Tap to confirm one as a bill, or
            hide it.
          </p>
          <Card style={{ padding:'4px 0' }}>
            {suggested.map((b, i) => (
              <div key={b.key}>{i > 0 && <Divider/>}
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 18px' }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:13, color:C.ink, fontFamily:SANS,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {b.label}
                    </p>
                    <p style={{ margin:'1px 0 0', fontSize:10, color:C.inkSoft, fontFamily:SANS }}>
                      seen in {b.monthsSeen} months · around the {b.day}
                      {b.varies ? ' · amount varies' : ''}
                    </p>
                  </div>
                  <span style={{ fontFamily:SERIF, fontSize:15, fontWeight:600, color:C.inkMid }}>
                    {fmt(b.amount)}
                  </span>
                  <button onClick={() => saveRule({ key:b.key, label:b.label, amount:b.amount,
                      day:b.day, category:b.category, status:'confirmed' })}
                    style={{ border:'none', borderRadius:8, padding:'6px 11px',
                      background:C.green, color:'#fff', fontSize:11, fontWeight:700,
                      cursor:'pointer', fontFamily:SANS, flexShrink:0 }}>
                    It's a bill
                  </button>
                  <button onClick={() => removeRule(b)}
                    style={{ border:`1px solid ${C.sandDark}`, borderRadius:8,
                      padding:'6px 9px', background:C.white, fontSize:11,
                      color:C.inkSoft, cursor:'pointer', fontFamily:SANS, flexShrink:0 }}>
                    Hide
                  </button>
                </div>
              </div>
            ))}
          </Card>
        </>
      )}

      <p style={{ fontSize:11, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6,
        padding:'0 4px', marginBottom:20 }}>
        Bills are found in your statements, then whatever you change here wins.
        Tap any bill to rename it, correct the amount or date, or remove it.
      </p>

      {editing !== undefined && (
        <BillEditModal bill={editing} allCats={allCats}
          onSave={saveRule} onDelete={removeRule}
          onClose={() => setEditing(undefined)}/>
      )}
    </div>
  );
}

// ─── CHARTS TAB ───────────────────────────────────────────────────────────────
export function ChartsTab({txns,bankImports,allCats,year,month,personView,profile}) {
  const me=firstName(profile?.name);
  const [view,setView]=useState('month'); // 'month' | 'year'
  const [annualData,setAnnualData]=useState([]);
  const [annualLoaded,setAnnualLoaded]=useState(false);

  useEffect(()=>{
    getAllBankImports().then(data=>{setAnnualData(data);setAnnualLoaded(true);}).catch(()=>{setAnnualLoaded(true);});
  },[]);

  // Monthly data
  const allTx=(personView==='mine'
    ? [...txns,...bankImports].filter(t=>!firstName(t.who)||firstName(t.who)===me)
    : [...txns,...bankImports]);
  const excludedIds=new Set(allCats.filter(c=>c.excluded).map(c=>c.id));
  const monthly={};
  allTx.forEach(t=>{const k=t.category||t.cat;
    if(k&&k!=='_skip'&&!excludedIds.has(k))monthly[k]=(monthly[k]||0)+t.amount;});
  const monthlyTotal=Object.values(monthly).reduce((a,b)=>a+b,0);
  const monthlySlices=allCats
    .map(c=>({id:c.id,label:c.label,color:c.color,value:monthly[c.id]||0}))
    .filter(d=>d.value>0)
    .sort((a,b)=>b.value-a.value);

  // Annual data
  const annual={};
  annualData.forEach(({category,amount})=>{
    if(category&&category!=='_skip'&&!excludedIds.has(category))
      annual[category]=(annual[category]||0)+amount;});
  const annualTotal=Object.values(annual).reduce((a,b)=>a+b,0);
  const annualSlices=allCats
    .map(c=>({id:c.id,label:c.label,color:c.color,value:annual[c.id]||0}))
    .filter(d=>d.value>0)
    .sort((a,b)=>b.value-a.value);

  // Monthly breakdown from annual
  const byMonth={};
  annualData.filter(d=>d.year===year&&!excludedIds.has(d.category))
    .forEach(({month:m,amount})=>{ byMonth[m]=(byMonth[m]||0)+amount; });

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



// ─── UPLOAD TAB v8 ────────────────────────────────────────────────────────────
// One button. No bank picker — the AI reads the statement and works out which
// institution it came from, including documents containing several accounts.
// Pipeline: pick → [processing] → identify (only if unsure) → validate → review → done
export function UploadTab({showToast, onImported, allCats, aiOn, aiDiag}) {
  const [who,       setWho]      = useState('jordan');
  const [step,      setStep]     = useState('pick');
  const [fileType,  setFileType] = useState(null);
  const [parsed,    setParsed]   = useState([]);
  const [edits,     setEdits]    = useState({});
  const [issues,    setIssues]   = useState([]);
  const [autoFixed, setAutoFixed]= useState([]);
  const [answers,   setAnswers]  = useState({});
  const [accounts,  setAccounts] = useState([]);   // detected institutions
  const [askBank,   setAskBank]  = useState(null); // { text } when we must ask
  const [pendingCSV,setPendingCSV]=useState(null); // raw text awaiting bank choice
  const [error,     setError]    = useState(null);
  const [csvFailed, setCsvFailed]= useState(false);
  const [modal,     setModal]    = useState(null);
  const [warnings,  setWarnings] = useState([]);
  const [insight,   setInsight]  = useState(null);
  const [saving,    setSaving]   = useState(false);
  const [imported,  setImported] = useState([]);   // ids actually saved
  const [autoStats, setAutoStats]= useState(null); // what was decided for you

  const tick = () => new Promise(r => setTimeout(r, 50));

  const finalRows = parsed.filter(row => {
    // Internal transfer — excluding it removes BOTH halves of the pair
    const tr = issues.find(i => i.type === 'internal_transfer' &&
      i.pairIds && i.pairIds.includes(row.id));
    if (tr) {
      const ans = answers[tr.id] ?? tr.default;
      if (ans.startsWith('Yes')) return false;
    }
    // E-transfer between the two of you — household money moving, not spending
    const pt = issues.find(i => i.type === 'partner_transfer' && i.row.id === row.id);
    if (pt) {
      const ans = answers[pt.id] ?? pt.default;
      if (ans.startsWith('Yes')) return false;
    }
    // Standalone card payment / transfer with no partner in this batch
    const pay = issues.find(i => i.type === 'card_payment' && i.row.id === row.id);
    if (pay) {
      const ans = answers[pay.id] ?? pay.default;
      if (ans.startsWith('Skip')) return false;
    }
    const dupEx = issues.find(i => i.type === 'duplicate_existing' && i.row.id === row.id);
    if (dupEx) {
      const ans = answers[dupEx.id] ?? dupEx.default;
      if (ans === 'Skip — already imported') return false;
    }
    const dupBatch = issues.find(i =>
      i.type === 'duplicate_in_batch' && (i.secondId === row.id || i.firstId === row.id));
    if (dupBatch) {
      const ans = answers[dupBatch.id] ?? dupBatch.default;
      if (ans === 'Keep first only'  && dupBatch.secondId === row.id) return false;
      if (ans === 'Keep second only' && dupBatch.firstId  === row.id) return false;
    }
    // Income is kept and filed, not discarded — the budget is built from it
    // (the retag itself happens in the .map below)
    const lg = issues.find(i => i.type === 'large_transaction' && i.row.id === row.id);
    if (lg) {
      const ans = answers[lg.id] ?? lg.default;
      if (ans.startsWith('Looks wrong')) return false;
    }
    if (edits[row.id]?.skip) return false;
    return true;
  }).map(row => {
    const cr = issues.find(i => i.type === 'credit_check' && i.row.id === row.id);
    const isIncome = cr && (answers[cr.id] ?? cr.default).startsWith('Yes');
    return {
      ...row,
      category: edits[row.id]?.cat || (isIncome ? 'income' : row.category),
      source:   edits[row.id]?.src || row.source,
      note:     edits[row.id]?.note || row.note || '',
      who,
    };
  });

  const byMonth = {};
  finalRows.forEach(r => {
    const k = MONTHS[r.month] + ' ' + r.year;
    if (!byMonth[k]) byMonth[k] = [];
    byMonth[k].push(r);
  });

  // Which institutions ended up in this batch
  const usedSources = [...new Set(finalRows.map(r => r.source))];

  // ── Shared tail of the pipeline: categorise → validate ──────────────────────
  async function finishPipeline(rawRows) {
    setModal({ title:'Categorising ' + rawRows.length + ' transactions',
      sub:'Matching merchants to your budget categories using your spending history…' });
    await tick();

    const others = rawRows.filter(r => r.category === 'other');
    if (AI_AVAILABLE && others.length > 0) {
      setModal({ title:'Asking Claude to help',
        sub: others.length + ' merchants weren\'t recognised. Getting category suggestions now…' });
      await tick();
      try {
        const aiMap = await aiCategorize(others, allCats.map(c => c.id));
        rawRows.forEach(r => { if (aiMap[r.id]) r.category = aiMap[r.id]; });
      } catch {}
    }

    setModal({ title:'Running smart checks',
      sub:'Checking for duplicates, income transactions, and data anomalies…' });
    await tick();

    let existing = [];
    try { existing = await getAllBankImportsRaw(); } catch {}

    // Cross-check against the other person's already-imported statements:
    // an e-transfer between the two of you is household money moving, not spending.
    const tagged = rawRows.map(r => ({ ...r, who }));
    const partnerIssues = detectPartnerTransfers(tagged, existing);

    const report = buildValidationReport(tagged, existing, partnerIssues);

    // Every issue takes its safe default. Nothing is asked up front: being made
    // to answer a hundred questions before seeing any of your data is not a
    // review, it is an obstacle. The decisions are all listed afterwards and
    // any of them can be changed.
    const defaults = Object.fromEntries(report.all.map(i => [i.id, i.default]));

    setModal({ title: 'Saving ' + tagged.length + ' transactions',
      sub: 'Categorising and filing them. Nothing needs your attention yet.' });
    await tick();

    setParsed(tagged);
    setEdits({});
    setIssues(report.all);
    setAutoFixed(report.autoFixed);
    setAnswers(defaults);

    await importRows(tagged, report.all, defaults);
    setModal(null);
  }

  // ── Entry point ─────────────────────────────────────────────────────────────
  async function runPipeline(file) {
    const isPDF = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    setError(null); setCsvFailed(false); setAccounts([]); setWarnings([]); setInsight(null);
    setFileType(isPDF ? 'pdf' : 'csv');

    if (isPDF) {
      if (aiOn === false) {
        setError('PDF reading needs ANTHROPIC_API_KEY set in your Netlify environment '
          + 'variables. Note: no VITE_ prefix — the key stays on the server. '
          + 'CSV upload works without it.');
        return;
      }
      setModal({ title:'Claude is reading your statement',
        sub:'Working out which bank it is from and pulling the transactions off each page.' });
      await tick();
      try {
        const result = await parsePDFStatement(file, p => {
          // Long documents are read in batches of pages so each request stays
          // well inside the serverless time limit
          setModal(p.batches > 1
            ? { title:`Reading pages ${p.from}–${p.to} of ${p.total}`,
                sub:`Batch ${p.batch} of ${p.batches}. Long statements are read a few pages `
                  + `at a time so nothing times out. Please keep this page open.` }
            : { title:'Claude is reading your statement',
                sub:'Pulling the transactions off each page.' });
        });
        setAccounts(result.accounts || []);
        setWarnings(result.warnings || []);
        if (!result.rows.length) {
          setModal(null);
          setError('Claude read the document but found no transactions in it.');
          return;
        }
        await finishPipeline(result.rows);
      } catch (err) {
        setModal(null);
        setError('Could not read that PDF: ' + err.message);
      }
      return;
    }

    // ── CSV path ──
    setModal({ title:'Reading your statement', sub:'Identifying the bank and extracting transactions…' });
    await tick();
    const text = await file.text().catch(() => null);
    if (!text) { setModal(null); setError('Could not read that file.'); return; }

    const detected = await detectBank(text);

    if (detected.id === 'UNKNOWN') {
      // Genuinely can't tell — this is the only time we bother the user
      setModal(null);
      setPendingCSV(text);
      setAskBank({ preview: text.split(/\r?\n/).slice(0, 4).join(' · ').slice(0, 160) });
      setStep('identify');
      return;
    }

    await parseCSVWith(text, detected);
  }

  async function parseCSVWith(text, detected) {
    setModal({ title:'Reading your statement',
      sub:'Recognised as ' + instLabel(detected.id) + '. Extracting transactions…' });
    await tick();

    const { rows, error: pe, debug } = parseStatementCSV(text, detected.id);
    if (pe || rows.length === 0) {
      setModal(null);
      setCsvFailed(true);
      setError((pe || 'No transactions found in that file.') +
        '\n\nDetected: ' + instLabel(detected.id) +
        ' · Columns: ' + (debug?.headers?.slice(0,5).join(', ') || 'none'));
      return;
    }

    setAccounts([{ key:'csv', institution:detected.id,
      institutionName:instLabel(detected.id), accountLabel:'',
      kind:instKind(detected.id), confidence:detected.confidence,
      how:detected.how }]);
    await finishPipeline(rows);
  }

  /** Which rows survive a given set of answers. */
  function resolve(rows, issueList, ans) {
    const answer = i => ans[i.id] ?? i.default;
    return rows.filter(row => {
      const pt = issueList.find(i => i.type === 'partner_transfer' && i.row.id === row.id);
      if (pt && answer(pt).startsWith('Yes')) return false;
      const tr = issueList.find(i => i.type === 'internal_transfer' && i.pairIds?.includes(row.id));
      if (tr && answer(tr).startsWith('Yes')) return false;
      const pay = issueList.find(i => i.type === 'card_payment' && i.row.id === row.id);
      if (pay && answer(pay).startsWith('Skip')) return false;
      const de = issueList.find(i => i.type === 'duplicate_existing' && i.row.id === row.id);
      if (de && answer(de) === 'Skip — already imported') return false;
      const db = issueList.find(i => i.type === 'duplicate_in_batch' &&
        (i.secondId === row.id || i.firstId === row.id));
      if (db) {
        const a = answer(db);
        if (a === 'Keep first only'  && db.secondId === row.id) return false;
        if (a === 'Keep second only' && db.firstId  === row.id) return false;
      }
      const lg = issueList.find(i => i.type === 'large_transaction' && i.row.id === row.id);
      if (lg && answer(lg).startsWith('Looks wrong')) return false;
      if (edits[row.id]?.skip) return false;
      return true;
    }).map(row => {
      const cr = issueList.find(i => i.type === 'credit_check' && i.row.id === row.id);
      const asIncome = cr && answer(cr).startsWith('Yes');
      return {
        ...row,
        category: edits[row.id]?.cat || (asIncome ? 'income' : row.category),
        source:   edits[row.id]?.src || row.source,
        note:     edits[row.id]?.note || row.note || '',
        who,
      };
    });
  }

  async function importRows(rows, issueList, ans) {
    const keep = resolve(rows, issueList, ans);
    const toSave = keep.map(({ _type, _confidence, _fromPDF, _acctLabel, _internal, ...r }) => ({
      ...r, direction: _type || 'debit',
    }));
    try {
      await insertBankImports(toSave);
      setImported(toSave.map(r => r.id));
      setAutoStats({
        saved:    toSave.length,
        skipped:  rows.length - keep.length,
        decisions: issueList.length,
      });
      onImported();
      setStep('done');
    } catch (err) {
      showToast('Import failed — ' + err.message);
      setStep('review');
    }
  }

  /** Re-sync after the user changes one of the automatic decisions. */
  async function applyDecisionChanges() {
    setSaving(true);
    const keep    = resolve(parsed, issues, answers);
    const keepIds = new Set(keep.map(r => r.id));
    const remove  = imported.filter(id => !keepIds.has(id));
    const add     = keep.filter(r => !imported.includes(r.id));
    try {
      if (remove.length) await deleteManyRows(remove);
      if (add.length) {
        await insertBankImports(add.map(({ _type, _confidence, _fromPDF, _acctLabel, _internal, ...r }) => ({
          ...r, direction: _type || 'debit',
        })));
      }
      setImported(keep.map(r => r.id));
      setAutoStats(p => ({ ...p, saved: keep.length, skipped: parsed.length - keep.length }));
      onImported();
      showToast(
        remove.length || add.length
          ? `Updated — ${add.length} added, ${remove.length} removed`
          : 'Nothing changed');
      setStep('done');
    } catch (e) { showToast('Could not update — ' + e.message); }
    setSaving(false);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await runPipeline(file);
  }

  async function confirmImport() {
    setSaving(true);
    const toSave = finalRows.map(({ _type, _confidence, _fromPDF, _acctLabel, _internal, ...r }) => ({
      ...r,
      direction: _type || 'debit',   // needed later to pair partner e-transfers
    }));
    try {
      await insertBankImports(toSave);
      onImported();
      setStep('done');

      // Generate the insight after saving so the user isn't kept waiting
      if (AI_AVAILABLE) {
        setInsight('loading');
        try {
          const hist = await getAllBankImports();
          const labels = Object.fromEntries(allCats.map(c => [c.id, c.label]));
          const out = await spendingInsight(toSave, hist, labels);
          setInsight(out || null);
        } catch { setInsight(null); }
      }
    } catch (err) {
      showToast('Import failed — ' + err.message);
    }
    setSaving(false);
  }

  function reset() {
    setStep('pick'); setParsed([]); setEdits({}); setIssues([]); setAnswers({});
    setAutoFixed([]);
    setError(null); setCsvFailed(false); setAccounts([]); setWarnings([]);
    setFileType(null); setModal(null); setAskBank(null); setPendingCSV(null);
    setInsight(null);
  }

  // ── Processing overlay ──────────────────────────────────────────────────────
  const Overlay = modal ? (
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
        </div>
      </div>
    </div>
  ) : null;

  // Small institution chip used in a few places
  const Chip = ({ id, label, sub }) => (
    <div style={{ display:'inline-flex', alignItems:'center', gap:7,
      background: instColor(id) + '14', border:'1px solid ' + instColor(id) + '44',
      borderRadius:99, padding:'5px 12px 5px 9px' }}>
      {instKind(id) === 'credit'
        ? <CreditCard size={13} color={instColor(id)}/>
        : <Landmark   size={13} color={instColor(id)}/>}
      <span style={{ fontSize:12, fontWeight:700, color:instColor(id), fontFamily:SANS }}>
        {label || instLabel(id)}
      </span>
      {sub && <span style={{ fontSize:11, color:instColor(id) + 'aa', fontFamily:SANS }}>{sub}</span>}
    </div>
  );

  // ── PICK ────────────────────────────────────────────────────────────────────
  if (step === 'pick') return (
    <div style={{ padding:'16px 16px 0' }}>
      {Overlay}

      <div style={{ background:'linear-gradient(135deg,#1a7a4a,#2d9d61)',
        borderRadius:16, padding:'20px 18px', marginBottom:14, color:'#fff' }}>
        <p style={{ margin:'0 0 6px', fontSize:16, fontWeight:700, fontFamily:SERIF }}>
          Upload a bank statement
        </p>
        <p style={{ margin:'0 0 10px', fontSize:13, fontFamily:SANS,
          color:'rgba(255,255,255,0.85)', lineHeight:1.6 }}>
          Just pick the file — <b>CSV or PDF</b>. You don't need to tell us which bank
          it's from; the statement says so and Claude reads it. One document can even
          hold several accounts.
        </p>
        <p style={{ margin:0, fontSize:12, color:'rgba(255,255,255,0.65)', fontFamily:SANS }}>
          💡 Every upload is checked for duplicates and income before anything is saved.
        </p>
      </div>

      {aiOn === true && !csvFailed && (
        <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd', borderRadius:12,
          padding:'10px 14px', marginBottom:14, display:'flex', gap:8, alignItems:'center' }}>
          <Sparkles size={13} color={C.purple}/>
          <p style={{ margin:0, fontSize:12, color:'#5b21b6', fontFamily:SANS }}>
            Claude connected — PDF reading, smart categorisation and data checks are active.
          </p>
        </div>
      )}
      {aiOn === false && !csvFailed && (() => {
        const d = aiDiag || {};
        const rejected = d.reason === 'rejected';
        return (
          <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:12,
            padding:'12px 14px', marginBottom:14 }}>
            <p style={{ margin:'0 0 4px', fontSize:13, fontWeight:700,
              color:C.amber, fontFamily:SANS }}>
              {rejected ? 'Anthropic rejected the API key'
                        : d.reason === 'missing' ? "Claude isn't connected yet"
                        : 'Claude is unavailable'}
            </p>
            <p style={{ margin:'0 0 8px', fontSize:12, color:'#92400e',
              fontFamily:SANS, lineHeight:1.6 }}>
              {rejected
                ? 'The variable is set, but the value is being refused. Almost always ' +
                  'this is a key that got truncated when pasted, or one that has been ' +
                  'revoked. Create a fresh key and paste the whole string.'
                : d.reason === 'missing'
                ? <>CSV upload still works. For PDF reading, add <b>ANTHROPIC_API_KEY</b> to
                    your Netlify environment variables and redeploy. No <code>VITE_</code>{' '}
                    prefix — that is what would leak the key into the browser.</>
                : (d.message || 'Could not reach Anthropic from the server.')}
            </p>
            {d.present && (
              <div style={{ background:'rgba(0,0,0,0.05)', borderRadius:7, padding:'7px 10px',
                fontFamily:'monospace', fontSize:11, color:'#92400e', lineHeight:1.7 }}>
                <div>key: {d.startsWith} {d.endsWith}</div>
                <div>length: {d.length} {d.length < 40 ? '← looks truncated' : ''}</div>
                <div>prefix ok: {d.looksValid ? 'yes' : 'no — should start sk-ant-'}</div>
                {d.hadWhitespace && <div>note: stray whitespace was trimmed</div>}
              </div>
            )}
          </div>
        );
      })()}

      {csvFailed && (
        <div style={{ background:'#fffbeb', border:'1.5px solid #b45309',
          borderRadius:14, padding:'16px', marginBottom:14 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:12 }}>
            <AlertCircle size={18} color={C.amber} style={{ flexShrink:0, marginTop:2 }}/>
            <div>
              <p style={{ margin:'0 0 4px', fontSize:14, fontWeight:700,
                color:C.amber, fontFamily:SANS }}>
                That CSV didn't work — but that's okay
              </p>
              <p style={{ margin:'0 0 8px', fontSize:13, color:'#92400e',
                fontFamily:SANS, lineHeight:1.6 }}>
                Banks don't always export a clean CSV — that's their problem, not yours.
                Upload the <b>PDF version</b> instead and Claude will read it page by page.
              </p>
              {error && (
                <div style={{ background:'rgba(0,0,0,0.05)', borderRadius:7,
                  padding:'6px 10px', fontFamily:'monospace', fontSize:11,
                  color:'#92400e', whiteSpace:'pre-wrap' }}>{error}</div>
              )}
            </div>
          </div>
          {aiOn !== false ? (
            <label style={{ display:'block', padding:'14px', borderRadius:11,
              background:C.amber, cursor:'pointer', textAlign:'center',
              fontSize:14, fontWeight:700, color:'#fff', fontFamily:SANS,
              position:'relative', overflow:'hidden', boxSizing:'border-box' }}>
              Try uploading the PDF instead →
              <input type="file" accept=".pdf,application/pdf" onChange={handleFile}
                style={{ position:'absolute', top:0, left:0, width:'100%',
                  height:'100%', opacity:0, cursor:'pointer' }}/>
            </label>
          ) : (
            <p style={{ margin:0, fontSize:12, color:'#92400e', fontFamily:SANS }}>
              Add <b>ANTHROPIC_API_KEY</b> to your Netlify environment variables
              to enable PDF reading.
            </p>
          )}
        </div>
      )}

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

      <SL>Whose spending is this?</SL>
      <div style={{ display:'flex', gap:8, marginBottom:22 }}>
        {[['jordan','Jordan','#1d4ed8','#eff6ff'],['ness','Ness','#be185d','#fdf2f8']].map(([k,l,col,bg]) => (
          <button key={k} onClick={() => setWho(k)} style={{ flex:1,
            border:'1.5px solid ' + (who===k ? col : C.sandDark),
            borderRadius:12, padding:'11px',
            background: who===k ? bg : C.white, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            <div style={{ width:24, height:24, borderRadius:'50%', background:col, color:'#fff',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:9, fontWeight:700 }}>
              {k==='jordan'?'JY':'NMK'}
            </div>
            <span style={{ fontSize:13, fontWeight:600,
              color: who===k ? col : C.inkMid, fontFamily:SANS }}>{l}</span>
          </button>
        ))}
      </div>

      <label style={{ display:'block', width:'100%', padding:'20px', borderRadius:14,
        background:C.ink, cursor:'pointer', textAlign:'center', fontSize:16,
        fontWeight:600, color:'#fff', fontFamily:SANS,
        boxSizing:'border-box', position:'relative', overflow:'hidden' }}>
        <Upload size={19} style={{ verticalAlign:'middle', marginRight:10 }}/>
        Choose a statement
        <input type="file"
          accept=".csv,.CSV,.pdf,.PDF,text/csv,text/plain,application/pdf"
          onChange={handleFile}
          style={{ position:'absolute', top:0, left:0, width:'100%',
            height:'100%', opacity:0, cursor:'pointer' }}/>
      </label>
      <p style={{ textAlign:'center', fontSize:12, color:C.inkSoft,
        marginTop:10, fontFamily:SANS, lineHeight:1.6 }}>
        CSV or PDF · The bank is detected automatically
      </p>
      <p style={{ textAlign:'center', fontSize:10, color:C.sandDark,
        marginTop:14, marginBottom:16, fontFamily:'monospace' }}>
        {__APP_VERSION__} · built {__BUILD_ID__}
      </p>
    </div>
  );

  // ── IDENTIFY — only shown when detection genuinely fails ────────────────────
  if (step === 'identify') return (
    <div style={{ padding:'16px 16px 0' }}>
      {Overlay}
      <Card style={{ padding:'20px 18px' }}>
        <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:12 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:C.amber+'1e',
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <HelpCircle size={18} color={C.amber}/>
          </div>
          <div>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:21, fontWeight:600, color:C.ink }}>
              Which bank is this from?
            </h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft,
              fontFamily:SANS, lineHeight:1.6 }}>
              This one doesn't name the institution anywhere we could find, so we need
              you to tell us just this once.
            </p>
          </div>
        </div>

        {askBank?.preview && (
          <div style={{ background:C.sand, borderRadius:9, padding:'8px 12px',
            marginBottom:14, fontFamily:'monospace', fontSize:11,
            color:C.inkSoft, wordBreak:'break-all' }}>
            {askBank.preview}…
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:7 }}>
          {INSTITUTIONS.filter(i => i.id !== 'UNKNOWN').map(inst => (
            <button key={inst.id}
              onClick={() => { setAskBank(null); setStep('pick');
                parseCSVWith(pendingCSV, { id:inst.id, confidence:'high',
                  how:'You told us this one' }); }}
              style={{ border:'1.5px solid ' + C.sandDark, borderRadius:11,
                padding:'12px 14px', background:C.white, cursor:'pointer',
                display:'flex', alignItems:'center', gap:10, textAlign:'left' }}>
              {inst.kind === 'credit'
                ? <CreditCard size={16} color={inst.color}/>
                : <Landmark   size={16} color={inst.color}/>}
              <span style={{ fontSize:14, fontWeight:600, color:C.ink, fontFamily:SANS }}>
                {inst.label}
              </span>
            </button>
          ))}
        </div>
      </Card>
      <button onClick={reset}
        style={{ border:'1px solid ' + C.sandDark, width:'100%', padding:'13px',
          borderRadius:12, fontSize:14, background:C.white, color:C.inkMid,
          cursor:'pointer', fontFamily:SANS, marginBottom:16 }}>
        Cancel
      </button>
    </div>
  );

  // ── VALIDATE ────────────────────────────────────────────────────────────────
  if (step === 'validate') {
    const questions   = issues.filter(i => !i.autoFixed);
    const excluded    = parsed.length - finalRows.length;
    const transferSum = autoFixed
      .filter(i => i.type === 'internal_transfer')
      .reduce((a, i) => a + i.row.amount, 0);

    const TYPE_META = {
      partner_transfer:   { icon:'💸', label:'Transfer between you two',          color:C.green },
      internal_transfer:  { icon:'🔄', label:'Money moved between your accounts', color:C.green },
      card_payment:       { icon:'💳', label:'Card payment or transfer',          color:C.green },
      duplicate_in_batch: { icon:'🔁', label:'Same transaction twice in this file',color:C.blue },
      duplicate_existing: { icon:'📋', label:'Already in your budget',            color:C.blue },
      credit_check:       { icon:'💰', label:'Looks like income',                 color:C.green },
      large_transaction:  { icon:'🔍', label:'Unusually large',                   color:C.amber },
    };

    return (
      <div style={{ padding:'16px 16px 0' }}>
        {Overlay}
        <div style={{ marginBottom:12 }}>
          <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
            What we decided for you
          </h2>
          <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
            Found {parsed.length} transactions.
            {' '}Everything is already imported. These are the judgement calls made
            along the way — change any that look wrong.
          </p>
        </div>

        {accounts.length > 0 && (
          <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:12 }}>
            {accounts.map((a,i) => (
              <Chip key={i} id={a.institution}
                label={a.institutionName || instLabel(a.institution)}
                sub={a.accountLabel || a.period || ''}/>
            ))}
          </div>
        )}

        {/* ── Auto-fixed summary ── */}
        {autoFixed.length > 0 && (
          <div style={{ background:C.greenLight, border:`1px solid ${C.green}44`,
            borderRadius:14, padding:'14px 16px', marginBottom:14 }}>
            <div style={{ display:'flex', gap:9, alignItems:'flex-start', marginBottom:10 }}>
              <div style={{ width:28, height:28, borderRadius:99, background:C.green,
                display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <Check size={16} color="#fff" strokeWidth={3}/>
              </div>
              <div style={{ flex:1 }}>
                <p style={{ margin:0, fontSize:14, fontWeight:700, color:C.green, fontFamily:SANS }}>
                  {autoFixed.length} issue{autoFixed.length!==1?'s':''} fixed automatically
                </p>
                <p style={{ margin:'3px 0 0', fontSize:12, color:C.green+'cc',
                  fontFamily:SANS, lineHeight:1.6 }}>
                  {transferSum > 0
                    ? `Includes ${fmt(transferSum)} of transfers between your own accounts — ` +
                      `counting those would have inflated your spending.`
                    : `These were unambiguous, so we handled them without asking.`}
                </p>
              </div>
            </div>

            <div style={{ background:'rgba(255,255,255,0.7)', borderRadius:10, padding:'4px 0' }}>
              {autoFixed.map((i, idx) => {
                const meta = TYPE_META[i.type] || { icon:'✓', label:'Resolved', color:C.green };
                const kept = (answers[i.id] ?? i.default) !== i.default;
                return (
                  <div key={i.id} style={{ display:'flex', alignItems:'center', gap:9,
                    padding:'8px 12px',
                    borderTop: idx ? `1px solid ${C.sandMid}` : 'none' }}>
                    <span style={{ fontSize:14, flexShrink:0, opacity: kept ? 0.35 : 1 }}>
                      {meta.icon}
                    </span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:12, fontWeight:600, color:C.ink,
                        fontFamily:SANS, textDecoration: kept ? 'line-through' : 'none',
                        opacity: kept ? 0.5 : 1,
                        overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {i.summary}
                      </p>
                      <p style={{ margin:0, fontSize:10, color:C.inkSoft, fontFamily:SANS }}>
                        {meta.label}
                      </p>
                    </div>
                    <button
                      onClick={() => setAnswers(p => ({ ...p,
                        [i.id]: kept ? i.default : i.options.find(o => o !== i.default) }))}
                      style={{ border:`1px solid ${C.sandDark}`, borderRadius:7,
                        padding:'4px 10px', background:C.white, fontSize:11,
                        fontWeight:600, color:C.inkMid, cursor:'pointer',
                        fontFamily:SANS, flexShrink:0 }}>
                      {kept ? 'Undo' : 'Keep it'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ background:'#f5f3ff', border:'1px solid #c4b5fd',
            borderRadius:12, padding:'10px 14px', marginBottom:12 }}>
            {warnings.map((w,i) => (
              <p key={i} style={{ margin: i?'4px 0 0':0, fontSize:11,
                color:'#5b21b6', fontFamily:SANS, lineHeight:1.6 }}>⚠ {w}</p>
            ))}
          </div>
        )}

        {/* ── Questions that genuinely need a human ── */}
        {questions.length > 0 && (
          <SL>Needs your call</SL>
        )}

        {questions.map((issue, idx) => {
          const ans  = answers[issue.id] ?? issue.default;
          const meta = TYPE_META[issue.type] || { icon:'❓', color:C.amber };
          const bc   = meta.color;
          return (
            <div key={issue.id} style={{ background:C.white, borderRadius:14,
              padding:'16px', marginBottom:12,
              boxShadow:'0 1px 4px rgba(0,0,0,0.05), 0 0 0 1px rgba(0,0,0,0.04)',
              borderLeft:`4px solid ${bc}` }}>
              <div style={{ display:'flex', gap:10, alignItems:'flex-start', marginBottom:10 }}>
                <div style={{ width:30, height:30, borderRadius:99, background:bc+'18',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:16, flexShrink:0 }}>{meta.icon}</div>
                <div style={{ flex:1 }}>
                  <p style={{ margin:'0 0 2px', fontSize:10, color:bc,
                    textTransform:'uppercase', letterSpacing:'0.08em',
                    fontFamily:SANS, fontWeight:700 }}>
                    {idx + 1} of {questions.length} · {meta.label}
                  </p>
                  <p style={{ margin:0, fontSize:14, color:C.ink,
                    fontFamily:SANS, lineHeight:1.65 }}>{issue.question}</p>
                </div>
              </div>

              {/* Both sides of a pair, when there are two */}
              <div style={{ background:C.sand, borderRadius:9, padding:'10px 14px',
                marginBottom:12 }}>
                {[issue.row, issue.against].filter(Boolean).map((r, ri) => (
                  <div key={ri} style={{ display:'flex', justifyContent:'space-between',
                    alignItems:'center', gap:8,
                    paddingTop: ri ? 8 : 0, marginTop: ri ? 8 : 0,
                    borderTop: ri ? `1px solid ${C.sandDark}` : 'none' }}>
                    <div style={{ minWidth:0 }}>
                      <p style={{ margin:0, fontSize:13, fontWeight:600, color:C.ink,
                        fontFamily:SANS, overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {r.description}
                      </p>
                      <p style={{ margin:'2px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                        {r.date} · {instLabel(r.source)}
                        {r._type === 'credit' ? ' · money in' : ' · money out'}
                      </p>
                    </div>
                    <p style={{ margin:0, fontFamily:SERIF, fontSize:17, fontWeight:700,
                      color:C.ink, flexShrink:0 }}>{fmt(r.amount)}</p>
                  </div>
                ))}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {issue.options.map(opt => (
                  <button key={opt}
                    onClick={() => setAnswers(p => ({ ...p, [issue.id]: opt }))}
                    style={{ border:`1.5px solid ${ans===opt ? C.green : C.sandDark}`,
                      borderRadius:10, padding:'10px 14px', cursor:'pointer',
                      background: ans===opt ? C.greenLight : C.white,
                      display:'flex', alignItems:'center', gap:10, textAlign:'left' }}>
                    <div style={{ width:18, height:18, borderRadius:'50%', flexShrink:0,
                      border:`2px solid ${ans===opt ? C.green : C.sandDark}`,
                      background: ans===opt ? C.green : 'transparent' }}/>
                    <span style={{ fontSize:13, fontWeight: ans===opt?600:400,
                      color: ans===opt?C.green:C.inkMid, fontFamily:SANS }}>{opt}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        <button onClick={applyDecisionChanges} disabled={saving}
          style={{ width:'100%', border:'none', padding:'16px', borderRadius:14,
            background:C.green, color:'#fff', fontSize:15, fontWeight:700,
            cursor:'pointer', fontFamily:SANS, marginBottom:8,
            display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          {saving ? <><Spinner size={14}/>Updating…</> : 'Apply these decisions'}
        </button>
        <button onClick={() => setStep('done')} disabled={saving}
          style={{ width:'100%', border:`1px solid ${C.sandDark}`, padding:'13px',
            borderRadius:12, background:C.white, color:C.inkMid, fontSize:14,
            cursor:'pointer', fontFamily:SANS, marginBottom:8 }}>
          Leave them as they are
        </button>
        <p style={{ textAlign:'center', fontSize:11, color:C.inkSoft,
          fontFamily:SANS, margin:'0 0 16px' }}>
          {excluded > 0
            ? `${excluded} transaction${excluded!==1?'s':''} will be left out of the import.`
            : 'Nothing is being excluded.'}
        </p>
      </div>
    );
  }

  // ── REVIEW ──────────────────────────────────────────────────────────────────
  if (step === 'review') return (
    <div style={{ padding:'16px 16px 0' }}>
      {Overlay}
      <div style={{ display:'flex', gap:8, marginBottom:10, alignItems:'center' }}>
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
            {fileType==='pdf' ? 'Read from PDF' : 'Read from CSV'}
            {Object.keys(byMonth).length > 1 ? ' · ' + Object.keys(byMonth).length + ' months' : ''}
            {usedSources.length > 1 ? ' · ' + usedSources.length + ' accounts' : ''}
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

      {accounts.length > 0 && (
        <div style={{ display:'flex', gap:7, flexWrap:'wrap', marginBottom:14 }}>
          {accounts.map((a,i) => (
            <Chip key={i} id={a.institution}
              label={a.institutionName || instLabel(a.institution)}
              sub={a.accountLabel || ''}/>
          ))}
        </div>
      )}

      {Object.entries(byMonth).map(([mk, rows]) => (
        <div key={mk}>
          <SL>{mk} — {rows.length} transactions · {fmt(rows.reduce((a,r)=>a+r.amount,0))}</SL>
          <Card style={{ padding:'4px 0', marginBottom:12 }}>
            {rows.map((tx, i) => {
              const ec  = edits[tx.id]?.cat || tx.category;
              const es  = edits[tx.id]?.src || tx.source;
              const skp = !!edits[tx.id]?.skip;
              const c   = allCats.find(x => x.id === ec) || { icon:'Package', color:C.inkSoft };
              const low = tx._confidence === 'low';
              const isCredit = tx._type === 'credit';
              return (
                <div key={tx.id}>
                  {i > 0 && <Divider/>}
                  <div style={{ padding:'10px 14px', opacity: skp ? 0.4 : 1,
                    background: skp ? C.sandMid : low ? '#fffbeb' : C.white }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <button
                        onClick={() => setEdits(p=>({...p,[tx.id]:{...p[tx.id],skip:!p[tx.id]?.skip}}))}
                        style={{ border:'none', background:'none', padding:0,
                          cursor:'pointer', flexShrink:0 }}>
                        <div style={{ width:20, height:20, borderRadius:5,
                          border:'1.5px solid ' + (skp ? C.sandDark : C.green),
                          background: skp ? 'transparent' : C.green,
                          display:'flex', alignItems:'center', justifyContent:'center' }}>
                          {!skp && <Check size={12} color="#fff" strokeWidth={3}/>}
                        </div>
                      </button>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ margin:0, fontSize:12, color:C.ink, fontFamily:SANS,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {tx.description}
                          {low && <span style={{ marginLeft:6, fontSize:10,
                            color:C.amber, fontWeight:600 }}>low confidence</span>}
                        </p>
                        <p style={{ margin:'1px 0 0', fontSize:10,
                          color:C.inkSoft, fontFamily:SANS }}>{tx.date}</p>
                      </div>
                      <select value={ec}
                        onChange={e => setEdits(p=>({...p,[tx.id]:{...p[tx.id],cat:e.target.value}}))}
                        style={{ border:'1px solid ' + c.color, borderRadius:7,
                          padding:'3px 6px', fontSize:10, fontWeight:700, color:c.color,
                          background:'#fff', cursor:'pointer', fontFamily:SANS, maxWidth:96 }}>
                        {allCats.map(x => (<option key={x.id} value={x.id}>{x.label}</option>))}
                      </select>
                      <p style={{ margin:0, fontFamily:SERIF, fontSize:15, fontWeight:600,
                        color:C.ink, minWidth:58, textAlign:'right' }}>{fmt(tx.amount)}</p>
                    </div>

                    {/* Account + direction, editable per row */}
                    <div style={{ display:'flex', alignItems:'center', gap:6,
                      marginTop:6, marginLeft:28 }}>
                      <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px',
                        borderRadius:99, fontFamily:SANS,
                        background: isCredit ? C.greenLight : C.sandMid,
                        color: isCredit ? C.green : C.inkSoft }}>
                        {isCredit ? 'INCOME' : 'SPENDING'}
                      </span>
                      <select value={es}
                        onChange={e => setEdits(p=>({...p,[tx.id]:{...p[tx.id],src:e.target.value}}))}
                        style={{ border:'1px solid ' + instColor(es) + '55', borderRadius:7,
                          padding:'2px 6px', fontSize:10, fontWeight:600,
                          color:instColor(es), background:'#fff',
                          cursor:'pointer', fontFamily:SANS }}>
                        {INSTITUTIONS.map(x => (
                          <option key={x.id} value={x.id}>{x.label}</option>
                        ))}
                      </select>
                    </div>
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
        {saving ? (<><Spinner/><span>Importing…</span></>)
          : 'Import ' + finalRows.length + ' transaction' + (finalRows.length!==1?'s':'')}
      </button>
    </div>
  );

  // ── DONE ────────────────────────────────────────────────────────────────────
  const questionCount = issues.filter(i => !i.autoFixed).length;

  return (
    <div style={{ padding:'16px 16px 0' }}>
      <Card style={{ background:C.greenLight, border:'1px solid rgba(26,122,74,0.2)',
        textAlign:'center', padding:'28px 20px' }}>
        <Check size={44} color={C.green} style={{ marginBottom:10 }}/>
        <h2 style={{ fontFamily:SERIF, fontSize:26, fontWeight:600,
          color:C.green, margin:'0 0 6px' }}>Imported</h2>
        <p style={{ margin:0, fontSize:14, color:C.green+'cc', fontFamily:SANS }}>
          {autoStats?.saved ?? 0} transactions saved and categorised.
        </p>
        {usedSources.length > 0 && (
          <div style={{ display:'flex', gap:6, flexWrap:'wrap',
            justifyContent:'center', marginTop:12 }}>
            {usedSources.map(id => <Chip key={id} id={id}/>)}
          </div>
        )}
      </Card>

      {/* What was decided without asking */}
      {(autoStats?.skipped > 0 || issues.length > 0) && (
        <Card>
          <div style={{ display:'flex', gap:9, alignItems:'flex-start', marginBottom:10 }}>
            <div style={{ width:28, height:28, borderRadius:99, background:C.blue+'18',
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <Sparkles size={14} color={C.blue}/>
            </div>
            <div style={{ flex:1 }}>
              <p style={{ margin:0, fontSize:14, fontWeight:700, color:C.ink, fontFamily:SANS }}>
                {autoStats?.skipped || 0} left out automatically
              </p>
              <p style={{ margin:'3px 0 0', fontSize:12, color:C.inkSoft,
                fontFamily:SANS, lineHeight:1.6 }}>
                Duplicates, transfers between your own accounts, and money coming in.
                You were not asked because the safe answer was obvious in each case.
                {questionCount > 0 && ` ${questionCount} were closer calls.`}
              </p>
            </div>
          </div>
          {issues.length > 0 && (
            <button onClick={() => setStep('validate')}
              style={{ width:'100%', border:`1px solid ${C.sandDark}`, borderRadius:10,
                padding:'11px', background:C.white, fontSize:13, fontWeight:600,
                color:C.ink, cursor:'pointer', fontFamily:SANS,
                display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              Review {issues.length} decision{issues.length===1?'':'s'}
              <ChevronRight size={14} color={C.inkSoft}/>
            </button>
          )}
        </Card>
      )}

      {/* AI insight */}
      {insight === 'loading' && (
        <Card style={{ display:'flex', alignItems:'center', gap:10 }}>
          <Spinner size={16}/>
          <p style={{ margin:0, fontSize:13, color:C.inkSoft, fontFamily:SANS }}>
            Working out what this means for your spending…
          </p>
        </Card>
      )}
      {insight && insight !== 'loading' && (
        <Card style={{ border:'1px solid #c4b5fd', background:'#faf9ff' }}>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
            <Sparkles size={15} color={C.purple}/>
            <p style={{ margin:0, fontSize:11, fontWeight:700, color:C.purple,
              textTransform:'uppercase', letterSpacing:'0.08em', fontFamily:SANS }}>
              What this changes
            </p>
          </div>
          {insight.headline && (
            <p style={{ margin:'0 0 10px', fontFamily:SERIF, fontSize:18,
              fontWeight:600, color:C.ink, lineHeight:1.4 }}>{insight.headline}</p>
          )}
          {(insight.points || []).map((pt,i) => (
            <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:7 }}>
              <div style={{ width:5, height:5, borderRadius:99, background:C.purple,
                marginTop:7, flexShrink:0 }}/>
              <p style={{ margin:0, fontSize:13, color:C.inkMid,
                fontFamily:SANS, lineHeight:1.6 }}>{pt}</p>
            </div>
          ))}
        </Card>
      )}

      <button onClick={() => setStep('review')}
        style={{ width:'100%', border:`1px solid ${C.sandDark}`, padding:'13px',
          borderRadius:12, background:C.white, color:C.inkMid, fontSize:13,
          cursor:'pointer', fontFamily:SANS, marginBottom:8 }}>
        See every imported transaction
      </button>
      <button onClick={reset}
        style={{ border:'none', width:'100%', padding:'15px', borderRadius:14,
          fontSize:14, fontWeight:600, background:C.ink, color:'#fff',
          cursor:'pointer', fontFamily:SANS, marginBottom:16 }}>
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

export function ActivityPanel({ items, onClose, onClear }) {
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



// ─── Duplicate cleanup ────────────────────────────────────────────────────────
// Import-time checks only see the batch being imported. Duplicates accumulate
// afterwards — a statement uploaded twice, or once under a misdetected bank and
// again after the fix. This finds them in what is already saved.
export function DuplicateModal({ rows, allCats, onDelete, onClose, showToast }) {
  const groups = findExistingDuplicates(rows || []);
  const [chosen, setChosen] = useState(() =>
    Object.fromEntries(groups.map(g => [g.id, true])));
  const [busy, setBusy] = useState(false);

  const selected  = groups.filter(g => chosen[g.id]);
  const toRemove  = selected.flatMap(g => g.remove);
  const reclaimed = selected.reduce((a, g) => a + g.amount * g.remove.length, 0);

  async function run() {
    setBusy(true);
    try {
      await onDelete(toRemove.map(r => r.id));
      showToast(`Removed ${toRemove.length} duplicate${toRemove.length === 1 ? '' : 's'}`);
      onClose();
    } catch (e) { showToast('Could not remove — ' + e.message); }
    setBusy(false);
  }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:770,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>
      <div style={{ position:'relative', background:C.sand, borderRadius:'20px 20px 0 0',
        maxHeight:'92dvh', display:'flex', flexDirection:'column', animation:'slideUp 0.25s ease' }}>

        <div style={{ padding:'20px 20px 14px', background:C.white,
          borderRadius:'20px 20px 0 0', borderBottom:`1px solid ${C.sandMid}`,
          display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
              {groups.length ? `${groups.length} duplicate${groups.length===1?'':'s'} found`
                             : 'No duplicates'}
            </h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              {groups.length
                ? 'Same merchant, same day, same amount. One copy is kept and the rest removed.'
                : 'Nothing in this month appears more than once.'}
            </p>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'12px 16px' }}>
          {groups.length === 0 && (
            <Card style={{ textAlign:'center', padding:'32px 20px' }}>
              <Check size={34} color={C.green} style={{ marginBottom:10 }}/>
              <p style={{ margin:0, fontSize:14, color:C.inkMid, fontFamily:SANS }}>
                This month looks clean.
              </p>
            </Card>
          )}

          {groups.map(g => {
            const on = chosen[g.id];
            const c  = allCats.find(x => x.id === (g.keep.category || g.keep.cat))
                    || { icon:'Package', color:C.inkSoft };
            return (
              <Card key={g.id} style={{ padding:'12px 14px',
                border:`1px solid ${on ? C.red + '55' : C.sandDark}` }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <button onClick={() => setChosen(p => ({ ...p, [g.id]: !p[g.id] }))}
                    style={{ border:'none', background:'none', padding:0, cursor:'pointer', flexShrink:0 }}>
                    <div style={{ width:20, height:20, borderRadius:5,
                      border:`1.5px solid ${on ? C.red : C.sandDark}`,
                      background: on ? C.red : 'transparent',
                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                      {on && <Check size={12} color="#fff" strokeWidth={3}/>}
                    </div>
                  </button>
                  <div style={{ width:30, height:30, borderRadius:9, background:c.color+'18',
                    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <CatIcon name={c.icon} size={15} color={c.color}/>
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:13, fontWeight:600, color:C.ink, fontFamily:SANS,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {g.label}
                    </p>
                    <p style={{ margin:'1px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>
                      {g.date} · appears {g.count} times
                    </p>
                  </div>
                  <span style={{ fontFamily:SERIF, fontSize:16, fontWeight:700, color:C.ink }}>
                    {fmt(g.amount)}
                  </span>
                </div>

                {g.crossAccount && (
                  <p style={{ margin:'0 0 8px', fontSize:11, color:C.amber,
                    fontFamily:SANS, lineHeight:1.5, paddingLeft:30 }}>
                    Recorded under {g.sources.map(instLabel).join(' and ')}. One purchase
                    cannot be on two accounts, so this is the same statement imported twice.
                  </p>
                )}

                <div style={{ paddingLeft:30 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:3 }}>
                    <Check size={11} color={C.green} strokeWidth={3}/>
                    <span style={{ fontSize:11, color:C.green, fontFamily:SANS }}>
                      keeping the {instLabel(g.keep.source)} copy
                    </span>
                  </div>
                  {g.remove.map(r => (
                    <div key={r.id} style={{ display:'flex', alignItems:'center', gap:7 }}>
                      <Trash2 size={11} color={on ? C.red : C.sandDark}/>
                      <span style={{ fontSize:11, fontFamily:SANS,
                        color: on ? C.red : C.inkSoft,
                        textDecoration: on ? 'line-through' : 'none' }}>
                        removing the {instLabel(r.source)} copy
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>

        {groups.length > 0 && (
          <div style={{ padding:'12px 16px 24px', background:C.white,
            borderTop:`1px solid ${C.sandMid}` }}>
            <button onClick={run} disabled={busy || toRemove.length === 0}
              style={{ width:'100%', border:'none', padding:'15px', borderRadius:12,
                background: toRemove.length ? C.red : C.sandDark,
                color: toRemove.length ? '#fff' : C.inkSoft,
                fontSize:15, fontWeight:700, fontFamily:SANS,
                cursor: toRemove.length ? 'pointer' : 'default',
                display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {busy ? <><Spinner size={14}/>Removing…</>
                    : `Remove ${toRemove.length} duplicate${toRemove.length===1?'':'s'}`}
            </button>
            <p style={{ margin:'8px 0 0', fontSize:11, color:C.inkSoft,
              textAlign:'center', fontFamily:SANS }}>
              {fmt(reclaimed)} of double-counted spending comes off your totals.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reset / danger zone ──────────────────────────────────────────────────────
// Deleting shared data is not reversible and affects both people, so this
// screen states plainly what will go, offers a backup first, and requires the
// full reset to be typed out rather than tapped.
export function ResetModal({ year, month, onClose, onDone, showToast }) {
  const [mode,    setMode]    = useState(null);    // null | 'month' | 'all'
  const [scope,   setScope]   = useState('all');   // for month mode
  const [counts,  setCounts]  = useState(null);
  const [typed,   setTyped]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [backedUp,setBackedUp]= useState(false);

  const CONFIRM = 'DELETE EVERYTHING';

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [m, a] = await Promise.all([countMonthData(year, month), countAllData()]);
        if (live) setCounts({ month: m, all: a });
      } catch { if (live) setCounts({ month:null, all:null }); }
    })();
    return () => { live = false; };
  }, [year, month]);

  async function downloadBackup() {
    try {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `budget-for-two-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackedUp(true);
      showToast('Backup downloaded');
    } catch (e) {
      showToast('Backup failed — ' + e.message);
    }
  }

  async function runMonthReset() {
    setBusy(true);
    try {
      await deleteMonthData(year, month, scope);
      showToast(`${MONTHS[month]} ${year} cleared`);
      onDone();
    } catch (e) { showToast('Could not clear — ' + e.message); }
    setBusy(false);
  }

  async function runFullReset() {
    setBusy(true);
    try {
      await deleteAllData();
      try {
        localStorage.removeItem('b42_custom_cats');
        localStorage.removeItem('b42_cat_targets');
        localStorage.removeItem('b42_notifs');
      } catch {}
      showToast('Everything cleared');
      onDone();
    } catch (e) { showToast('Could not clear — ' + e.message); }
    setBusy(false);
  }

  const m = counts?.month;
  const a = counts?.all;
  const monthCount = scope === 'all' ? (m ? m.manual + m.imported : 0)
                   : scope === 'imported' ? (m?.imported || 0)
                   : (m?.manual || 0);

  const Opt = ({ id, label, sub }) => (
    <button onClick={() => setScope(id)}
      style={{ border:`1.5px solid ${scope===id ? C.green : C.sandDark}`, borderRadius:10,
        padding:'10px 14px', cursor:'pointer', width:'100%', textAlign:'left',
        background: scope===id ? C.greenLight : C.white,
        display:'flex', alignItems:'flex-start', gap:10, marginBottom:6 }}>
      <div style={{ width:16, height:16, borderRadius:'50%', flexShrink:0, marginTop:2,
        border:`2px solid ${scope===id ? C.green : C.sandDark}`,
        background: scope===id ? C.green : 'transparent' }}/>
      <div>
        <p style={{ margin:0, fontSize:13, fontWeight:scope===id?600:400,
          color:scope===id?C.green:C.ink, fontFamily:SANS }}>{label}</p>
        <p style={{ margin:'1px 0 0', fontSize:11, color:C.inkSoft, fontFamily:SANS }}>{sub}</p>
      </div>
    </button>
  );

  return (
    <div style={{ position:'fixed', inset:0, zIndex:750,
      display:'flex', flexDirection:'column', justifyContent:'flex-end' }}>
      <div onClick={onClose} style={{ position:'absolute', inset:0, background:'rgba(26,26,24,0.6)' }}/>
      <div style={{ position:'relative', background:C.sand, borderRadius:'20px 20px 0 0',
        maxHeight:'92dvh', display:'flex', flexDirection:'column', animation:'slideUp 0.25s ease' }}>

        <div style={{ padding:'20px 20px 14px', background:C.white,
          borderRadius:'20px 20px 0 0', borderBottom:`1px solid ${C.sandMid}`,
          display:'flex', alignItems:'flex-start', gap:12 }}>
          <div style={{ flex:1 }}>
            <h2 style={{ margin:0, fontFamily:SERIF, fontSize:22, fontWeight:600, color:C.ink }}>
              Reset data
            </h2>
            <p style={{ margin:'4px 0 0', fontSize:13, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              Start a month over, or wipe the budget and begin again. Both of you share
              this data, so anything removed here disappears for your partner too.
            </p>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'none', padding:6, cursor:'pointer' }}>
            <X size={20} color={C.inkSoft}/>
          </button>
        </div>

        <div style={{ overflowY:'auto', flex:1, padding:'14px 16px' }}>

          {/* Backup first */}
          <Card style={{ border:`1px solid ${C.green}44`, background:C.greenLight }}>
            <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
              <Download size={17} color={C.green} style={{ flexShrink:0, marginTop:2 }}/>
              <div style={{ flex:1 }}>
                <p style={{ margin:'0 0 3px', fontSize:13, fontWeight:700, color:C.green, fontFamily:SANS }}>
                  Download a backup first
                </p>
                <p style={{ margin:'0 0 10px', fontSize:12, color:C.green+'cc',
                  fontFamily:SANS, lineHeight:1.6 }}>
                  A JSON file with every transaction and setting. Nothing here can be
                  undone, so this is your only way back.
                </p>
                <button onClick={downloadBackup}
                  style={{ border:'none', borderRadius:9, padding:'8px 16px',
                    background:C.green, color:'#fff', fontSize:13, fontWeight:600,
                    cursor:'pointer', fontFamily:SANS, display:'flex', alignItems:'center', gap:6 }}>
                  {backedUp ? <><Check size={13}/> Downloaded — get another</> : 'Download backup'}
                </button>
              </div>
            </div>
          </Card>

          {/* Reset one month */}
          <Card>
            <p style={{ margin:'0 0 3px', fontSize:14, fontWeight:700, color:C.ink, fontFamily:SANS }}>
              Reset {MONTHS[month]} {year}
            </p>
            <p style={{ margin:'0 0 10px', fontSize:12, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              {m
                ? `${m.imported} imported and ${m.manual} manual ${m.manual===1?'entry':'entries'} in this month.`
                : 'Counting…'}
              {' '}Other months are untouched.
            </p>

            {mode === 'month' ? (
              <>
                <Opt id="all"      label="Everything in this month"
                     sub={m ? `${m.imported + m.manual} transactions` : ''}/>
                <Opt id="imported" label="Imported transactions only"
                     sub={m ? `${m.imported} rows · keeps anything you typed in` : ''}/>
                <Opt id="manual"   label="Manual entries only"
                     sub={m ? `${m.manual} rows · keeps imported statements` : ''}/>

                <div style={{ display:'flex', gap:8, marginTop:12 }}>
                  <button onClick={() => setMode(null)} disabled={busy}
                    style={{ flex:1, border:`1px solid ${C.sandDark}`, borderRadius:10,
                      padding:'12px', background:C.white, fontSize:13, color:C.inkMid,
                      cursor:'pointer', fontFamily:SANS }}>
                    Cancel
                  </button>
                  <button onClick={runMonthReset} disabled={busy || monthCount === 0}
                    style={{ flex:2, border:'none', borderRadius:10, padding:'12px',
                      background: monthCount ? C.red : C.sandDark,
                      color: monthCount ? '#fff' : C.inkSoft,
                      fontSize:13, fontWeight:700,
                      cursor: monthCount ? 'pointer' : 'default', fontFamily:SANS,
                      display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                    {busy ? <><Spinner size={13}/>Clearing…</>
                          : monthCount ? `Delete ${monthCount} transaction${monthCount===1?'':'s'}`
                          : 'Nothing to delete'}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => { setMode('month'); setScope('all'); }}
                style={{ border:`1px solid ${C.red}55`, borderRadius:10, padding:'11px 16px',
                  background:C.white, fontSize:13, fontWeight:600, color:C.red,
                  cursor:'pointer', fontFamily:SANS, width:'100%' }}>
                Reset this month…
              </button>
            )}
          </Card>

          {/* Full wipe */}
          <Card style={{ border:`1px solid ${C.red}44` }}>
            <p style={{ margin:'0 0 3px', fontSize:14, fontWeight:700, color:C.red, fontFamily:SANS }}>
              Reset everything
            </p>
            <p style={{ margin:'0 0 10px', fontSize:12, color:C.inkSoft, fontFamily:SANS, lineHeight:1.6 }}>
              Deletes every transaction from every month, both people, plus your
              category targets and custom categories.
              {a ? ` That is ${a.imported + a.manual} transactions in total.` : ''}
              {' '}Your accounts and sign-in stay as they are.
            </p>

            {mode === 'all' ? (
              <>
                <p style={{ margin:'0 0 6px', fontSize:12, color:C.ink, fontFamily:SANS }}>
                  Type <b style={{ fontFamily:'monospace' }}>{CONFIRM}</b> to confirm:
                </p>
                <input value={typed} onChange={e => setTyped(e.target.value)}
                  placeholder={CONFIRM} autoComplete="off"
                  style={{ width:'100%', border:`1.5px solid ${typed===CONFIRM?C.red:C.sandDark}`,
                    borderRadius:9, padding:'11px 13px', fontSize:14, color:C.ink,
                    background:C.white, fontFamily:'monospace', outline:'none',
                    boxSizing:'border-box', marginBottom:10 }}/>
                <div style={{ display:'flex', gap:8 }}>
                  <button onClick={() => { setMode(null); setTyped(''); }} disabled={busy}
                    style={{ flex:1, border:`1px solid ${C.sandDark}`, borderRadius:10,
                      padding:'12px', background:C.white, fontSize:13, color:C.inkMid,
                      cursor:'pointer', fontFamily:SANS }}>
                    Cancel
                  </button>
                  <button onClick={runFullReset} disabled={busy || typed !== CONFIRM}
                    style={{ flex:2, border:'none', borderRadius:10, padding:'12px',
                      background: typed===CONFIRM ? C.red : C.sandDark,
                      color: typed===CONFIRM ? '#fff' : C.inkSoft,
                      fontSize:13, fontWeight:700,
                      cursor: typed===CONFIRM ? 'pointer' : 'default', fontFamily:SANS,
                      display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                    {busy ? <><Spinner size={13}/>Deleting…</> : 'Delete everything'}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => setMode('all')}
                style={{ border:'none', borderRadius:10, padding:'11px 16px',
                  background:C.red, fontSize:13, fontWeight:700, color:'#fff',
                  cursor:'pointer', fontFamily:SANS, width:'100%' }}>
                Reset everything…
              </button>
            )}
          </Card>

          <p style={{ fontSize:11, color:C.inkSoft, fontFamily:SANS,
            lineHeight:1.6, padding:'0 4px 20px' }}>
            Deleting removes the data, not the account. You can both still sign in, and
            uploading a statement again rebuilds the month from scratch.
          </p>
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
  const [view,       setView      ]=useState('combined');
  const [aiOn,       setAiOn      ]=useState(null); // null = still checking
  const [aiDiag,     setAiDiag    ]=useState(null);
  const [history,    setHistory   ]=useState([]);   // all imports, for recurring detection
  const [showReset,  setShowReset ]=useState(false);
  const [billRules,  setBillRules ]=useState([]);
  const [showDupes,  setShowDupes ]=useState(false);
  const [billsLocal, setBillsLocal]=useState(false);

  // Alphabetical everywhere, so a category is always where you expect it —
  // including custom ones added later.
  const allCats=[...DEFAULT_CATS,...customCats]
    .sort((a,b)=>a.label.localeCompare(b.label,'en',{sensitivity:'base'}));

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
      const [t,b,s,ai,hist]=await Promise.all([getTxns(year,month),getBankImports(year,month),
        getSettings(year,month),getAllBankImports(),getAllBankImportsRaw()]);
      setHistory(hist);
      try {
        // If the bill_rules table exists but local edits are waiting, push them up
        try { await syncLocalBillRules(); } catch {}
        setBillRules(await getBillRules());
        const mod = await import('./supabase.js');
        setBillsLocal(!!mod.billRulesLocalOnly);
      } catch {}
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

  // Move one transaction to a different category. Works for both manual
  // entries and imported rows, and updates local state immediately so the
  // drill-down and the bars reflect the change without a round trip.
  async function handleChangeCategory(tx, newCat) {
    const isImport = tx.description !== undefined || tx.source !== undefined;
    try {
      if (isImport) {
        await updateBankImport(tx.id, { category: newCat });
        setImports(prev => prev.map(t => t.id === tx.id ? { ...t, category: newCat } : t));
      } else {
        await updateTransaction(tx.id, { cat: newCat });
        setTxns(prev => prev.map(t => t.id === tx.id ? { ...t, cat: newCat } : t));
      }
      const label = allCats.find(c => c.id === newCat)?.label || newCat;
      showToast(`Moved to ${label}`);
    } catch (e) {
      showToast('Could not move that transaction');
    }
  }

  // One row deleted from wherever it lives
  async function deleteRow(tx) {
    const isImport = tx._table === 'bank_imports' || tx.description !== undefined;
    try {
      if (isImport) {
        await deleteBankImport(tx.id);
        setImports(prev => prev.filter(t => t.id !== tx.id));
      } else {
        await deleteTxn(tx.id);
        setTxns(prev => prev.filter(t => t.id !== tx.id));
      }
      showToast('Deleted');
    } catch (e) { showToast('Could not delete — ' + e.message); }
  }

  async function deleteRows(ids) {
    await deleteManyRows(ids);
    setImports(prev => prev.filter(t => !ids.includes(t.id)));
    setTxns(prev => prev.filter(t => !ids.includes(t.id)));
    await loadAll();
  }

  async function saveBillRule(rule) {
    try {
      await upsertBillRule(rule);
      setBillRules(await getBillRules());
      const mod = await import('./supabase.js');
      setBillsLocal(!!mod.billRulesLocalOnly);
      showToast(rule.status === 'hidden' ? 'Hidden from bills' : 'Bill saved');
    } catch (e) { showToast('Could not save — ' + e.message); }
  }

  async function removeBillRule(key) {
    try {
      await deleteBillRule(key);
      setBillRules(await getBillRules());
    } catch (e) { showToast('Could not remove — ' + e.message); }
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
  async function saveSettings(ccVal){
    const cc = ccVal ?? ccTarget;
    if(saveRef.current)clearTimeout(saveRef.current);
    saveRef.current=setTimeout(async()=>{
      // income is derived from transactions now; only the CC target is stored
      try{await upsertSettings(year,month,{},cc);}catch{}
    },800);
  }

  // Ask the serverless function whether the key is configured server-side
  useEffect(()=>{ checkAI()
    .then(ok=>{ setAiOn(ok); setAiDiag(aiDiagnostics()); })
    .catch(()=>setAiOn(false)); },[]);

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
    {id:'bills',  label:'Bills',  Icon:CalendarDays},
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
        <button onClick={()=>setShowReset(true)}
          title="Reset data"
          style={{border:'none',background:'none',padding:'5px 4px',cursor:'pointer',
            display:'flex',alignItems:'center'}}>
          <Settings size={18} color={C.sandDark} strokeWidth={1.6}/>
        </button>
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
      {tab==='home'    && <HomeTab txns={txns} bankImports={imports} ccTarget={ccTarget}
          setCcTarget={setCcTarget} allCats={allCats} catTargets={catTargets}
          view={view} setView={setView} history={history} billRules={billRules}
          onSaveSettings={saveSettings} suggested={suggested} onAcceptSuggested={acceptSuggested}
          onAddCat={addCustomCat} onDeleteCat={deleteCustomCat} profile={profile}
          onReviewOther={openReview}
          otherCount={imports.filter(t=>(t.category||t.cat)==='other').length}
          onChangeCategory={handleChangeCategory}
          onDeleteRow={deleteRow}
          duplicateCount={findExistingDuplicates([...txns,...imports]).length}
          onReviewDuplicates={()=>setShowDupes(true)}/>}
      {tab==='add'     && <AddTab profile={profile} allCats={allCats} onAdd={async tx=>{await addTxn(tx);showToast(`Added ${fmt(tx.amount)}`);setTab('home');}}/>}
      {tab==='history' && <HistoryTab txns={txns} bankImports={imports} allCats={allCats}
          onDeleteTxn={removeTxn} onDeleteImport={removeImport} onSaveNote={handleSaveNote}/>}
      {tab==='bills'   && <BillsTab history={history} txns={txns}
          bankImports={imports} allCats={allCats} year={year} month={month}
          billRules={billRules} showToast={showToast} billsLocal={billsLocal}
          onSaveRule={saveBillRule} onDeleteRule={removeBillRule}/>}
      {tab==='charts'  && <ChartsTab txns={txns} bankImports={imports} allCats={allCats}
          year={year} month={month} personView={view} profile={profile}/>}
      {tab==='upload'  && <UploadTab showToast={showToast} onImported={loadAll}
          allCats={allCats} aiOn={aiOn} aiDiag={aiDiag}/>}

      {showReset && (
        <ResetModal
          year={year} month={month}
          showToast={showToast}
          onClose={()=>setShowReset(false)}
          onDone={async ()=>{
            setShowReset(false);
            setCustomCats([]); setCatTargets({}); setSuggested({}); setNotifs([]);
            await loadAll();
          }}
        />
      )}

      {showDupes && (
        <DuplicateModal
          rows={[...txns, ...imports]}
          allCats={allCats}
          showToast={showToast}
          onDelete={deleteRows}
          onClose={()=>setShowDupes(false)}
        />
      )}

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
          onDeleteRow={async tx => { await deleteRow(tx); setOtherItems(p=>p.filter(t=>t.id!==tx.id)); }}
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
                :<Icon size={20} color={tab===id?C.green:C.sandDark} strokeWidth={tab===id?2:1.5}/>}
              {!accent&&<span style={{fontSize:10,fontFamily:SANS,fontWeight:tab===id?600:400,
                color:tab===id?C.green:C.inkSoft,letterSpacing:'0'}}>{label}</span>}
            </button>
          ))}
        </div>
      </div>
      {toast&&<Toast msg={toast}/>}
    </div>
  );
}
