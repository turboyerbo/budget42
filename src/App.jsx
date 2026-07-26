import { useState, useEffect, useRef } from 'react';
import { storage } from './storage.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const CATS = [
  { id:'groceries',    label:'Groceries',      icon:'🛒', target:400,  color:'#16a34a' },
  { id:'restaurant',   label:'Eating out',     icon:'🍽️', target:250,  color:'#2563eb' },
  { id:'alcohol',      label:'Alcohol',        icon:'🍺', target:80,   color:'#ea580c' },
  { id:'uber',         label:'Uber',           icon:'🚗', target:80,   color:'#ca8a04' },
  { id:'transit',      label:'Transit',        icon:'🚇', target:30,   color:'#7c3aed' },
  { id:'pharmacy',     label:'Pharmacy',       icon:'💊', target:100,  color:'#db2777' },
  { id:'medical',      label:'Medical',        icon:'🏥', target:550,  color:'#dc2626' },
  { id:'entertainment',label:'Entertainment',  icon:'🎭', target:50,   color:'#059669' },
  { id:'hobbies',      label:'Hobbies & dev',  icon:'💻', target:150,  color:'#6366f1' },
  { id:'other',        label:'Other',          icon:'📦', target:200,  color:'#6b7280' },
];

const FIXED = [
  { label:'Rent (STELA)',          amount:1900,   due:'Last day'     },
  { label:'Electricity (Metergy)', amount:150,    due:'~15th'        },
  { label:'TD Insurance',          amount:66.50,  due:'End of month' },
  { label:'Freedom Mobile',        amount:45.20,  due:'~20th'        },
  { label:'Affirm Canada',         amount:51.51,  due:'~23rd'        },
  { label:'BMO Plan Fee',          amount:17.95,  due:'Last day'     },
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
  { label:'Centre for Mindbody', amount:275,   date:'Aug 4',  crit:false, type:'medical' },
];

const USERS = {
  jordan: { key:'jordan', name:'Jordan', initials:'JY',  color:'#2563eb', bg:'#eff6ff' },
  ness:   { key:'ness',   name:'Ness',   initials:'NMK', color:'#e11d48', bg:'#fff1f2' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = n =>
  '$' + Math.abs(n).toLocaleString('en-CA', { minimumFractionDigits:2, maximumFractionDigits:2 });

const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const todayStr = () => new Date().toISOString().slice(0, 10);

const sKey = (y, m) => `hb3_${y}_${m}`;

const defData = () => ({
  income: { jordan:3984.44, ness:800, sunlife:0 },
  cc_target: 500,
  transactions: [],
});

// ─── Tiny UI atoms ────────────────────────────────────────────────────────────

function Avatar({ who, size = 28 }) {
  const u = USERS[who] || USERS.jordan;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: u.color, color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.31, fontWeight: 700, letterSpacing: '-0.02em', flexShrink: 0,
    }}>
      {u.initials}
    </div>
  );
}

function ProgressBar({ spent, target, color }) {
  const pct = Math.min((spent / Math.max(target, 1)) * 100, 100);
  return (
    <div style={{ height: 5, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${pct}%`, borderRadius: 99,
        background: spent > target ? '#ef4444' : color,
        transition: 'width 0.3s ease',
      }} />
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <p style={{
      fontSize: 11, fontWeight: 700, color: '#94a3b8',
      textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px',
    }}>
      {children}
    </p>
  );
}

function Toast({ msg }) {
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
      background: '#111827', color: '#fff', padding: '10px 20px', borderRadius: 99,
      fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', zIndex: 999,
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)', pointerEvents: 'none',
    }}>
      {msg}
    </div>
  );
}

// ─── User Picker (first launch) ───────────────────────────────────────────────

function UserPicker({ onPick }) {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 32, background: '#f8fafc',
    }}>
      <div style={{ fontSize: 56, marginBottom: 6 }}>🏠</div>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 6px', color: '#0f172a', letterSpacing: '-0.03em' }}>
        Home budget
      </h1>
      <p style={{ fontSize: 15, color: '#64748b', margin: '0 0 40px', textAlign: 'center' }}>
        Jordan &amp; Ness — shared household tracker
      </p>
      {Object.values(USERS).map(u => (
        <button
          key={u.key}
          onClick={() => onPick(u.key)}
          style={{
            border: `2px solid ${u.color}`, borderRadius: 18,
            background: u.bg, cursor: 'pointer', width: '100%', maxWidth: 320,
            padding: '16px 20px', display: 'flex', alignItems: 'center',
            gap: 14, marginBottom: 12, textAlign: 'left',
          }}
        >
          <Avatar who={u.key} size={46} />
          <div>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0f172a' }}>I'm {u.name}</p>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Log expenses as {u.name}</p>
          </div>
        </button>
      ))}
      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 20, textAlign: 'center', maxWidth: 260 }}>
        Your choice is saved on this device.<br />
        All spending is shared between both of you via the Sync tab.
      </p>
    </div>
  );
}

// ─── HOME TAB ─────────────────────────────────────────────────────────────────

function HomeTab({ data, totalIncome, totalFixed, totalSubs, totalSpent, surplus, setData, saveData }) {
  const txByCat = {};
  data.transactions.forEach(t => { txByCat[t.cat] = (txByCat[t.cat] || 0) + t.amount; });

  const jordanSpend = data.transactions.filter(t => t.who === 'jordan').reduce((a, t) => a + t.amount, 0);
  const nessSpend   = data.transactions.filter(t => t.who === 'ness').reduce((a, t) => a + t.amount, 0);
  const committed   = totalFixed + totalSubs + (data.cc_target || 0);

  return (
    <div style={{ padding: '14px 14px 0' }}>

      {/* Summary strip */}
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[
            ['Income',    fmt(totalIncome),                              '#16a34a'],
            ['Committed', fmt(committed),                               '#ea580c'],
            ['Surplus',   (surplus >= 0 ? '+' : '–') + fmt(surplus),   surplus >= 0 ? '#16a34a' : '#ef4444'],
          ].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <p style={{ margin: '0 0 3px', fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{l}</p>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums' }}>{v}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* CTFS alert */}
      <div style={{
        background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12,
        padding: '10px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>⚠️</span>
        <div style={{ flex: 1 }}>
          <p style={{ margin: '0 0 2px', fontSize: 12, fontWeight: 700, color: '#991b1b' }}>
            CTFS: $18,933 @ 22% APR · ~$438/mo interest
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 11, color: '#b91c1c' }}>Monthly payment target: $</p>
            <input
              type="number"
              value={data.cc_target}
              onChange={e => {
                const d = { ...data, cc_target: parseFloat(e.target.value) || 0 };
                setData(d); saveData(d);
              }}
              style={{
                width: 64, border: '1px solid #fca5a5', borderRadius: 6, padding: '2px 6px',
                fontSize: 12, fontWeight: 700, color: '#991b1b', background: '#fff',
              }}
            />
          </div>
        </div>
      </div>

      {/* Per-person breakdown */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {Object.values(USERS).map(u => {
          const spent = u.key === 'jordan' ? jordanSpend : nessSpend;
          return (
            <div key={u.key} style={{ flex: 1, background: u.bg, borderRadius: 12, padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <Avatar who={u.key} size={20} />
                <span style={{ fontSize: 12, fontWeight: 600, color: u.color }}>{u.name} added</span>
              </div>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(spent)}
              </p>
            </div>
          );
        })}
      </div>

      {/* Category budget bars */}
      <SectionLabel>Spending this month</SectionLabel>
      <Card style={{ padding: '10px 14px' }}>
        {CATS.map((cat, i) => {
          const spent = txByCat[cat.id] || 0;
          const over  = spent > cat.target;
          return (
            <div key={cat.id} style={{
              paddingBottom: i < CATS.length - 1 ? 10 : 0,
              marginBottom:  i < CATS.length - 1 ? 10 : 0,
              borderBottom:  i < CATS.length - 1 ? '1px solid #f8fafc' : 'none',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>{cat.icon}</span>
                <span style={{ flex: 1, fontSize: 12, color: '#374151' }}>{cat.label}</span>
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: over ? '#ef4444' : spent > 0 ? '#0f172a' : '#cbd5e1',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmt(spent)}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 2 }}>/ {fmt(cat.target)}</span>
              </div>
              <ProgressBar spent={spent} target={cat.target} color={cat.color} />
              {over && (
                <p style={{ margin: '3px 0 0', fontSize: 10, color: '#ef4444' }}>
                  Over by {fmt(spent - cat.target)}
                </p>
              )}
            </div>
          );
        })}
      </Card>

      {/* Income editor */}
      <SectionLabel>Income this month</SectionLabel>
      <Card style={{ padding: '10px 14px' }}>
        {[
          ['jordan', 'Jordan — NORR salary (est.)'],
          ['ness',   'Ness — contribution'],
          ['sunlife','SunLife reimbursement'],
        ].map(([k, l]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            {k !== 'sunlife'
              ? <Avatar who={k} size={20} />
              : <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>💙</span>}
            <span style={{ flex: 1, fontSize: 12, color: '#374151' }}>{l}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 12, color: '#16a34a' }}>$</span>
              <input
                type="number"
                value={data.income[k]}
                onChange={e => {
                  const d = { ...data, income: { ...data.income, [k]: parseFloat(e.target.value) || 0 } };
                  setData(d); saveData(d);
                }}
                style={{
                  width: 84, border: '1px solid #e5e7eb', borderRadius: 8, padding: '3px 6px',
                  fontSize: 12, fontWeight: 700, color: '#0f172a', textAlign: 'right',
                  background: '#f8fafc',
                }}
              />
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── ADD TAB ──────────────────────────────────────────────────────────────────

function AddTab({ user, onAdd }) {
  const [cat,    setCat]    = useState(null);
  const [amount, setAmount] = useState('');
  const [note,   setNote]   = useState('');
  const [date,   setDate]   = useState(todayStr());
  const [who,    setWho]    = useState(user);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const can = cat && parseFloat(amount) > 0;

  function submit() {
    if (!can) return;
    onAdd({ cat, amount: parseFloat(amount), note: note.trim(), date, who });
    setCat(null); setAmount(''); setNote(''); setDate(todayStr());
    inputRef.current?.focus();
  }

  return (
    <div style={{ padding: '14px 14px 0' }}>

      {/* Big amount input */}
      <Card style={{ textAlign: 'center', padding: '20px 14px' }}>
        <p style={{ margin: '0 0 4px', fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Amount
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <span style={{ fontSize: 30, fontWeight: 300, color: '#94a3b8' }}>$</span>
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            style={{
              fontSize: 52, fontWeight: 800, color: '#0f172a',
              border: 'none', outline: 'none', background: 'none',
              width: 180, textAlign: 'center', letterSpacing: '-0.03em',
              fontFamily: 'Georgia, Times, serif', fontVariantNumeric: 'tabular-nums',
            }}
          />
        </div>
      </Card>

      {/* Category picker */}
      <SectionLabel>Category</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 7, marginBottom: 12 }}>
        {CATS.map(c => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            style={{
              border: `2px solid ${cat === c.id ? c.color : '#f1f5f9'}`,
              borderRadius: 12, padding: '9px 3px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              background: cat === c.id ? c.color : '#fff',
              transition: 'all 0.12s',
            }}
          >
            <span style={{ fontSize: 20 }}>{c.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: cat === c.id ? '#fff' : '#64748b', textAlign: 'center', lineHeight: 1.2 }}>
              {c.label}
            </span>
          </button>
        ))}
      </div>

      {/* Note, date, who */}
      <Card>
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={e => setNote(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          style={{
            width: '100%', border: 'none', outline: 'none',
            fontSize: 15, color: '#0f172a', background: 'none', marginBottom: 12,
          }}
        />
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Date</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 8px',
                fontSize: 12, color: '#374151', background: '#f8fafc', width: '100%',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 3 }}>Added by</label>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.values(USERS).map(u => (
                <button
                  key={u.key}
                  onClick={() => setWho(u.key)}
                  style={{
                    border: `1px solid ${who === u.key ? u.color : '#e5e7eb'}`,
                    borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 700,
                    background: who === u.key ? u.color : '#f8fafc',
                    color: who === u.key ? '#fff' : '#64748b',
                  }}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* Submit */}
      <button
        onClick={submit}
        disabled={!can}
        style={{
          border: 'none', width: '100%', padding: '15px', borderRadius: 14,
          fontSize: 15, fontWeight: 800, transition: 'all 0.15s',
          background: can ? '#16a34a' : '#e5e7eb',
          color: can ? '#fff' : '#94a3b8',
          marginBottom: 10,
        }}
      >
        {can
          ? `Add ${CATS.find(c => c.id === cat)?.icon || ''} ${fmt(parseFloat(amount))}`
          : 'Choose a category and enter an amount'}
      </button>
    </div>
  );
}

// ─── HISTORY TAB ──────────────────────────────────────────────────────────────

function HistoryTab({ data, onDelete }) {
  const [filter, setFilter] = useState('all');

  const txs = [...data.transactions]
    .filter(t => filter === 'all' || t.who === filter)
    .sort((a, b) => b.ts - a.ts);

  const grouped = {};
  txs.forEach(t => {
    const label = t.date
      ? new Date(t.date + 'T00:00:00').toLocaleDateString('en-CA', { weekday:'short', month:'short', day:'numeric' })
      : 'Recent';
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(t);
  });

  return (
    <div style={{ padding: '14px 14px 0' }}>
      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[['all','Everyone'],['jordan','Jordan'],['ness','Ness']].map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              border: 'none', padding: '5px 12px', borderRadius: 99, fontSize: 12, fontWeight: 600,
              background: filter === k ? '#0f172a' : '#f1f5f9',
              color:      filter === k ? '#fff'    : '#64748b',
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {txs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
          <p style={{ fontSize: 15 }}>No transactions yet</p>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            {filter === 'all' ? 'Tap + Add to log your first expense' : `No entries for ${USERS[filter]?.name}`}
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([day, items]) => (
          <div key={day}>
            <p style={{ margin: '0 0 6px', fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {day}
            </p>
            <Card style={{ padding: '2px 0' }}>
              {items.map((tx, i) => {
                const cat = CATS.find(c => c.id === tx.cat) || { icon:'📦', label:'Other' };
                return (
                  <div key={tx.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                    borderBottom: i < items.length - 1 ? '1px solid #f8fafc' : 'none',
                  }}>
                    <span style={{ fontSize: 22, flexShrink: 0 }}>{cat.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tx.note || cat.label}
                      </p>
                      {tx.note && <p style={{ margin: '1px 0 0', fontSize: 11, color: '#94a3b8' }}>{cat.label}</p>}
                    </div>
                    <Avatar who={tx.who} size={22} />
                    <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}>
                      {fmt(tx.amount)}
                    </span>
                    <button
                      onClick={() => { if (window.confirm('Remove this transaction?')) onDelete(tx.id); }}
                      style={{ border: 'none', background: 'none', color: '#d1d5db', fontSize: 20, lineHeight: 1, padding: '0 0 0 4px' }}
                    >
                      ×
                    </button>
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
  const typeColor = { bill:'#2563eb', sub:'#7c3aed', medical:'#dc2626', debt:'#ef4444' };
  const typeLabel = { bill:'Bill', sub:'Sub', medical:'Medical', debt:'⚠ Debt' };

  return (
    <div style={{ padding: '14px 14px 0' }}>
      <SectionLabel>Upcoming — next 30 days</SectionLabel>
      <Card style={{ padding: '2px 0' }}>
        {UPCOMING.map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
            background: item.crit ? '#fef2f2' : 'transparent',
            borderBottom: i < UPCOMING.length - 1 ? '1px solid #f8fafc' : 'none',
          }}>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: item.crit ? 700 : 500, color: item.crit ? '#991b1b' : '#0f172a' }}>
                {item.label}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: item.crit ? '#b91c1c' : '#94a3b8' }}>{item.date}</p>
            </div>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 99,
              background: (typeColor[item.type] || '#6b7280') + '22',
              color: typeColor[item.type] || '#6b7280',
            }}>
              {typeLabel[item.type] || item.type}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: item.crit ? '#991b1b' : '#0f172a', fontVariantNumeric: 'tabular-nums', minWidth: 64, textAlign: 'right' }}>
              {fmt(item.amount)}
            </span>
          </div>
        ))}
      </Card>

      <SectionLabel>Monthly fixed — {fmt(FIXED.reduce((a, b) => a + b.amount, 0))}/mo</SectionLabel>
      <Card style={{ padding: '2px 0' }}>
        {FIXED.map((f, i) => (
          <div key={i} style={{ display: 'flex', padding: '9px 14px', borderBottom: i < FIXED.length - 1 ? '1px solid #f8fafc' : 'none' }}>
            <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>{f.label}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 10 }}>{f.due}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{fmt(f.amount)}</span>
          </div>
        ))}
      </Card>

      <SectionLabel>Subscriptions — {fmt(SUBS.reduce((a, b) => a + b.amount, 0))}/mo</SectionLabel>
      <Card style={{ padding: '2px 0' }}>
        {SUBS.map((s, i) => (
          <div key={i} style={{ display: 'flex', padding: '9px 14px', borderBottom: i < SUBS.length - 1 ? '1px solid #f8fafc' : 'none' }}>
            <span style={{ flex: 1, fontSize: 13, color: '#374151' }}>{s.label}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 10 }}>{s.due}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{fmt(s.amount)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ─── SYNC TAB ─────────────────────────────────────────────────────────────────

function SyncTab({ showToast }) {
  const [exported,  setExported]  = useState('');
  const [importing, setImporting] = useState('');
  const [result,    setResult]    = useState(null);

  function doExport() {
    const json = storage.exportAll();
    setExported(json);
    setResult(null);
  }

  function copyToClipboard() {
    navigator.clipboard.writeText(exported).then(() => showToast('Copied — paste it for the other person'));
  }

  function doImport() {
    try {
      const count = storage.importAll(importing);
      setResult({ ok: true, msg: `Merged ${count} record(s). Reload the app to see changes.` });
      setImporting('');
    } catch {
      setResult({ ok: false, msg: 'Invalid data — make sure you pasted the full export.' });
    }
  }

  function doClear() {
    if (!window.confirm('This will permanently erase all household data on THIS device. Continue?')) return;
    storage.clearShared();
    showToast('All shared data cleared');
    setExported(''); setResult(null);
  }

  return (
    <div style={{ padding: '14px 14px 0' }}>

      {/* How sync works */}
      <Card style={{ background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
        <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: '#166534' }}>How to sync between phones</p>
        <p style={{ margin: 0, fontSize: 12, color: '#15803d', lineHeight: 1.6 }}>
          1. On the phone that has the latest data, tap <strong>Export</strong> below.<br />
          2. Copy the text and send it to the other person (iMessage, email, etc.).<br />
          3. On the other phone, paste the text in the <strong>Import</strong> box and tap Import.<br />
          4. Reload the app — both phones now have the same data.
        </p>
      </Card>

      {/* Export */}
      <SectionLabel>Export — share your data</SectionLabel>
      <Card>
        <button
          onClick={doExport}
          style={{
            border: 'none', borderRadius: 10, padding: '12px 20px',
            background: '#0f172a', color: '#fff', fontSize: 14, fontWeight: 700,
            width: '100%', marginBottom: exported ? 10 : 0,
          }}
        >
          Generate export
        </button>
        {exported && (
          <>
            <textarea
              readOnly
              value={exported}
              rows={5}
              style={{
                width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8,
                fontSize: 10, fontFamily: 'monospace', color: '#374151', background: '#f8fafc',
                resize: 'none', marginBottom: 8,
              }}
            />
            <button
              onClick={copyToClipboard}
              style={{
                border: '1px solid #16a34a', borderRadius: 10, padding: '10px',
                background: '#f0fdf4', color: '#166534', fontSize: 13, fontWeight: 700,
                width: '100%',
              }}
            >
              Copy to clipboard
            </button>
          </>
        )}
      </Card>

      {/* Import */}
      <SectionLabel>Import — receive data from the other phone</SectionLabel>
      <Card>
        <textarea
          placeholder="Paste the export text here…"
          value={importing}
          onChange={e => setImporting(e.target.value)}
          rows={5}
          style={{
            width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8,
            fontSize: 11, fontFamily: 'monospace', color: '#374151', background: '#f8fafc',
            resize: 'none', marginBottom: 8,
          }}
        />
        <button
          onClick={doImport}
          disabled={!importing.trim()}
          style={{
            border: 'none', borderRadius: 10, padding: '12px',
            background: importing.trim() ? '#2563eb' : '#e5e7eb',
            color: importing.trim() ? '#fff' : '#94a3b8',
            fontSize: 14, fontWeight: 700, width: '100%',
          }}
        >
          Import data
        </button>
        {result && (
          <p style={{ margin: '8px 0 0', fontSize: 12, fontWeight: 600, color: result.ok ? '#16a34a' : '#dc2626' }}>
            {result.msg}
          </p>
        )}
      </Card>

      {/* Danger zone */}
      <SectionLabel>Danger zone</SectionLabel>
      <Card style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
        <p style={{ margin: '0 0 10px', fontSize: 12, color: '#991b1b' }}>
          Clears all household budget data on this device only. Export first if you want to keep it.
        </p>
        <button
          onClick={doClear}
          style={{
            border: '1px solid #fca5a5', borderRadius: 10, padding: '10px',
            background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 700, width: '100%',
          }}
        >
          Clear all data on this device
        </button>
      </Card>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

export default function App() {
  const now = new Date();
  const [user,   setUser  ] = useState(null);
  const [tab,    setTab   ] = useState('home');
  const [month,  setMonth ] = useState(now.getMonth());
  const [year,   setYear  ] = useState(now.getFullYear());
  const [data,   setData  ] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [toast,  setToast ] = useState(null);

  // ── Initialise user from personal storage ──────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get('hb_user', false);
        if (r) setUser(r.value);
      } catch {}
      setLoaded(true);
    })();
  }, []);

  // ── Load month data from shared storage ────────────────────────────────────
  useEffect(() => {
    if (!loaded || !user) return;
    (async () => {
      try {
        const r = await storage.get(sKey(year, month), true);
        setData(r ? JSON.parse(r.value) : defData());
      } catch {
        setData(defData());
      }
    })();
  }, [user, month, year, loaded]);

  async function saveData(d) {
    setData(d);
    await storage.set(sKey(year, month), JSON.stringify(d), true);
  }

  async function pickUser(u) {
    await storage.set('hb_user', u, false);
    setUser(u);
  }

  function switchUser() {
    const next = user === 'jordan' ? 'ness' : 'jordan';
    storage.set('hb_user', next, false);
    setUser(next);
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  }

  function changeMonth(dir) {
    let m = month + dir, y = year;
    if (m < 0)  { m = 11; y--; }
    if (m > 11) { m = 0;  y++; }
    setMonth(m); setYear(y);
  }

  function addTransaction(tx) {
    const d = { ...data, transactions: [{ ...tx, id: uid(), ts: Date.now() }, ...data.transactions] };
    saveData(d);
    showToast(`Added ${fmt(tx.amount)}`);
    setTab('home');
  }

  function deleteTransaction(id) {
    const d = { ...data, transactions: data.transactions.filter(t => t.id !== id) };
    saveData(d);
    showToast('Removed');
  }

  // ── Loading & onboarding states ───────────────────────────────────────────
  if (!loaded) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <span style={{ fontSize: 32 }}>⌛</span>
      </div>
    );
  }

  if (!user) return <UserPicker onPick={pickUser} />;

  if (!data) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      </div>
    );
  }

  const u          = USERS[user];
  const totalIncome = Object.values(data.income).reduce((a, b) => a + b, 0);
  const totalFixed  = FIXED.reduce((a, b) => a + b.amount, 0);
  const totalSubs   = SUBS.reduce((a, b) => a + b.amount, 0);
  const totalSpent  = data.transactions.reduce((a, t) => a + t.amount, 0);
  const surplus     = totalIncome - totalFixed - totalSubs - totalSpent - (data.cc_target || 0);

  const TABS = [
    { id:'home',    label:'Home',    icon:'🏠' },
    { id:'add',     label:'Add',     icon:'+' },
    { id:'history', label:'History', icon:'📋' },
    { id:'bills',   label:'Bills',   icon:'📅' },
    { id:'sync',    label:'Sync',    icon:'🔄' },
  ];

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100dvh', background: '#f8fafc', paddingBottom: 72 }}>

      {/* ── Sticky header ─────────────────────────────────────────────── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #f1f5f9',
        padding: '10px 14px 8px', position: 'sticky', top: 0, zIndex: 10,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <button
          onClick={() => changeMonth(-1)}
          style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '5px 10px', background: '#fff', fontSize: 16, color: '#374151', lineHeight: 1 }}
        >‹</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
            {MONTHS[month]} {year}
          </p>
        </div>
        <button
          onClick={() => changeMonth(1)}
          style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '5px 10px', background: '#fff', fontSize: 16, color: '#374151', lineHeight: 1 }}
        >›</button>
        {/* User switcher */}
        <button
          onClick={switchUser}
          style={{
            border: 'none', borderRadius: 99, padding: '5px 10px 5px 6px',
            background: u.bg, display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4,
          }}
        >
          <Avatar who={user} size={20} />
          <span style={{ fontSize: 11, fontWeight: 800, color: u.color }}>{u.name}</span>
        </button>
      </div>

      {/* ── Tab bar (below header) ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', borderBottom: '1px solid #f1f5f9', background: '#fff',
        position: 'sticky', top: 50, zIndex: 9,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, border: 'none', padding: '8px 0', background: 'none',
              fontSize: t.id === 'add' ? 20 : 13,
              fontWeight: tab === t.id ? 800 : 500,
              color: tab === t.id ? '#16a34a' : '#94a3b8',
              borderBottom: `2px solid ${tab === t.id ? '#16a34a' : 'transparent'}`,
            }}
          >
            {t.id === 'add' ? t.icon : t.label}
          </button>
        ))}
      </div>

      {/* ── Page content ──────────────────────────────────────────────── */}
      {tab === 'home'    && <HomeTab    data={data} totalIncome={totalIncome} totalFixed={totalFixed} totalSubs={totalSubs} totalSpent={totalSpent} surplus={surplus} setData={setData} saveData={saveData} />}
      {tab === 'add'     && <AddTab     user={user} onAdd={addTransaction} />}
      {tab === 'history' && <HistoryTab data={data} onDelete={deleteTransaction} />}
      {tab === 'bills'   && <BillsTab />}
      {tab === 'sync'    && <SyncTab    showToast={showToast} />}

      {toast && <Toast msg={toast} />}
    </div>
  );
}
