import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Plus,
  Wallet,
  Coins,
  Pencil,
  Save,
  X,
  RotateCcw,
  DollarSign,
  ExternalLink,
  Download,
  LineChart,     // 👈 add
  PlusCircle,    // 👈 add
  Trash2,        // 👈 add
} from "lucide-react";
import html2canvas from "html2canvas";

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────

type HistoryPoint = { t: number; balance: number; openValue: number };

type AppState = {
  startingBalance: number | null;
  balance: number;
  entries: Entry[];
  nextId: number;
  history?: HistoryPoint[];          // 👈 new
};

const STORAGE_KEY = "sol-paper-trading-state-v2"; // 👈 bump key

type Entry = {
  id: string;
  name: string;
  entryMarketCap: number; // weighted average mcap while open; fixed at close
  currentMarketCap?: number; // latest mcap the user set (displayed under name)
  solInvested: number; // current open SOL invested
  status: "open" | "sold";
  // DCA tracking
  cumulativeBuySOL?: number; // total SOL ever bought
  cumulativeSellAmount?: number; // total SOL base sold
  cumulativeSellReturnedSOL?: number; // total SOL returned from sells
  realizedPnl?: number; // realized across partial sells
  // Final close snapshot
  sellMarketCap?: number; // last sell mcap
  solReturned?: number; // total returned across all sells
  pnl?: number; // final realized pnl
  pnlPercent?: number; // final realized % vs cumulative buys
  soldAt?: string;
};


function saveState(state: AppState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { startingBalance: null, balance: 0, entries: [], nextId: 1, history: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.balance !== "number" || !Array.isArray(parsed.entries)) {
      return { startingBalance: null, balance: 0, entries: [], nextId: 1, history: [] };
    }
    if (!Array.isArray(parsed.history)) parsed.history = [];
    // Ensure required fields
    return {
      startingBalance: parsed.startingBalance ?? null,
      balance: parsed.balance,
      entries: parsed.entries,
      nextId: parsed.nextId ?? 1,
      history: parsed.history,
    };
  } catch {
    return { startingBalance: null, balance: 0, entries: [], nextId: 1, history: [] };
  }
}

function fmtSOL(n: number) { return `${n.toFixed(4)} SOL`; }
function fmtNum(n: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(n); }
function isFinitePos(n: any) { return typeof n === "number" && isFinite(n) && n > 0; }

// ────────────────────────────────────────────────────────────────────────────────
// App
// ────────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  useEffect(() => { saveState(state); }, [state]);

  // UI state
  const [graphOpen, setGraphOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [buyMoreId, setBuyMoreId] = useState<string | null>(null);
  const [previewEntry, setPreviewEntry] = useState<Entry | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showActiveOnly, setShowActiveOnly] = useState(false);
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const [balanceDelta, setBalanceDelta] = useState<string>("");
  const [mcapEditId, setMcapEditId] = useState<string | null>(null);
  const [mcapEditValue, setMcapEditValue] = useState<string>("");

  const openEntries = useMemo(() => state.entries.filter(e => e.status === "open"), [state.entries]);
  const soldEntries = useMemo(() => state.entries.filter(e => e.status === "sold"), [state.entries]);


// append a new history point if changed
function pushHistoryPoint() {
  setState(s => {
    const openValue = s.entries
      .filter(e => e.status === "open")
      .reduce((sum, e) => {
        const cur = (e.currentMarketCap ?? e.entryMarketCap);
        const mult = cur > 0 ? cur / e.entryMarketCap : 1;
        return sum + e.solInvested * mult;
      }, 0);

    const h = s.history ?? [];
    const last = h[h.length - 1];
    const point: HistoryPoint = { t: Date.now(), balance: s.balance, openValue };
    if (last && Math.abs(last.balance - point.balance) < 1e-9 && Math.abs(last.openValue - point.openValue) < 1e-9) {
      return s; // no change
    }
    return { ...s, history: [...h, point] };
  });
}

// on first mount or when balance/open changes, push a point
useEffect(() => {
  if (state.startingBalance !== null) pushHistoryPoint();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [state.balance, state.entries]); // runs after buys/sells/mcap edits
  const totals = useMemo(() => {
    const investedOpen = openEntries.reduce((s, e) => {
      const cur = (e.currentMarketCap ?? e.entryMarketCap);
      const mult = cur > 0 ? cur / e.entryMarketCap : 1;
      return s + e.solInvested * mult;
    }, 0);
    const realized = soldEntries.reduce((s, e) => s + (e.pnl ?? 0), 0);
    return { investedOpen, realized };
  }, [openEntries, soldEntries]);

  // Win rate (classic: per closed trade)
  const winStats = useMemo(() => {
    const closed = soldEntries.length;
    const wins = soldEntries.filter(e => (e.pnl ?? 0) > 0).length;
    const losses = closed - wins;
    const winRate = closed > 0 ? (wins / closed) * 100 : 0;
    return { closed, wins, losses, winRate };
  }, [soldEntries]);

  const avgReturns = useMemo(() => {
  if (soldEntries.length === 0) return { avgPct: 0, avgAbs: 0 };
  const pctList = soldEntries.map(e => e.pnlPercent ?? 0);
  const absList = soldEntries.map(e => e.pnl ?? 0);
  const avgPct = pctList.reduce((a, b) => a + b, 0) / pctList.length;
  const avgAbs = absList.reduce((a, b) => a + b, 0) / absList.length;
  return { avgPct, avgAbs };
}, [soldEntries]);

  // Entries to render (with hide old toggle)
  const entriesForList = useMemo(() => {
    const list = showActiveOnly ? state.entries.filter(e => e.status === 'open') : state.entries;
    return list;
  }, [state.entries, showActiveOnly]);

  // ── Actions ───────────────────────────────────────────────────────────────
  function setStartingBalance(n: number) {
    setState({ startingBalance: n, balance: n, entries: [], nextId: 1 });
  }

  function addEntry(data: { name: string; entryMarketCap: number; solInvested: number }) {
    setState(s => {
      if (s.balance < data.solInvested) { alert("Insufficient balance."); return s; }
      const entry: Entry = {
        id: String(s.nextId),
        name: data.name.trim() || `Entry #${s.nextId}`,
        entryMarketCap: data.entryMarketCap,
        currentMarketCap: data.entryMarketCap,
        solInvested: data.solInvested,
        status: "open",
        cumulativeBuySOL: data.solInvested,
        cumulativeSellAmount: 0,
        cumulativeSellReturnedSOL: 0,
        realizedPnl: 0,
      };
      return { ...s, balance: s.balance - data.solInvested, entries: [entry, ...s.entries], nextId: s.nextId + 1 };
    });
    setShowNew(false);
  }

  function updateCurrentMcap(id: string, mcap: number) {
    setState(s => {
      const idx = s.entries.findIndex(e => e.id === id); if (idx === -1) return s;
      const e = s.entries[idx];
      const updated: Entry = { ...e, currentMarketCap: mcap };
      const entries = [...s.entries]; entries[idx] = updated;
      return { ...s, entries };
    });
  }

  function editEntry(id: string, updates: Partial<Pick<Entry, "name" | "entryMarketCap" | "solInvested">>) {
    setState(s => {
      const idx = s.entries.findIndex(e => e.id === id); if (idx === -1) return s;
      const e = s.entries[idx]; if (e.status !== "open") return s;
      let newBalance = s.balance;
      const updated: Entry = { ...e };
      if (typeof updates.name === "string") updated.name = updates.name;
      if (typeof updates.entryMarketCap === "number" && isFinitePos(updates.entryMarketCap)) {
        updated.entryMarketCap = updates.entryMarketCap;
        // when editing avg entry, do not change current mcap automatically
      }
      if (typeof updates.solInvested === "number" && isFinite(updates.solInvested)) {
        const delta = updates.solInvested - e.solInvested;
        if (delta > 0 && s.balance < delta) { alert("Insufficient balance to increase position size."); return s; }
        updated.solInvested = Math.max(0, updates.solInvested);
        newBalance -= delta;
      }
      const entries = [...s.entries]; entries[idx] = updated;
      return { ...s, balance: newBalance, entries };
    });
    setEditingId(null);
  }

  // DCA Buy (Buy More)
  function buyMore(id: string, currentMcap: number, buyAmountSOL: number) {
    setState(s => {
      const idx = s.entries.findIndex(e => e.id === id); if (idx === -1) return s;
      const e = s.entries[idx]; if (e.status !== "open") return s;
      if (s.balance < buyAmountSOL) { alert("Insufficient balance."); return s; }
      const curInv = e.solInvested;
      const newAvg = (e.entryMarketCap * curInv + currentMcap * buyAmountSOL) / (curInv + buyAmountSOL);
      const updated: Entry = {
        ...e,
        entryMarketCap: newAvg,
        currentMarketCap: currentMcap,
        solInvested: curInv + buyAmountSOL,
        cumulativeBuySOL: (e.cumulativeBuySOL ?? 0) + buyAmountSOL,
      };
      const entries = [...s.entries]; entries[idx] = updated;
      return { ...s, balance: s.balance - buyAmountSOL, entries };
    });
    setBuyMoreId(null);
  }

  // DCA Sell (Partial sell)
  function partialSell(id: string, sellMcap: number, sellAmountSOL: number) {
    setState(s => {
      const idx = s.entries.findIndex(e => e.id === id); if (idx === -1) return s;
      const e = s.entries[idx]; if (e.status !== "open") return s;
      if (sellAmountSOL <= 0 || sellAmountSOL > e.solInvested) { alert("Sell amount must be > 0 and ≤ invested."); return s; }
      const multiplier = sellMcap / e.entryMarketCap;
      const returned = sellAmountSOL * multiplier;
      const realized = returned - sellAmountSOL;
      const remaining = e.solInvested - sellAmountSOL;

      let updated: Entry = {
        ...e,
        currentMarketCap: sellMcap,
        solInvested: remaining,
        realizedPnl: (e.realizedPnl ?? 0) + realized,
        cumulativeSellAmount: (e.cumulativeSellAmount ?? 0) + sellAmountSOL,
        cumulativeSellReturnedSOL: (e.cumulativeSellReturnedSOL ?? 0) + returned,
        sellMarketCap: sellMcap,
      };

      if (remaining <= 0.0000001) {
        // Close position
        const pnl = updated.realizedPnl ?? 0;
        const totalBuys = updated.cumulativeBuySOL ?? 0;
        updated = {
          ...updated,
          status: "sold",
          solReturned: updated.cumulativeSellReturnedSOL,
          pnl,
          pnlPercent: totalBuys > 0 ? (pnl / totalBuys) * 100 : 0,
          soldAt: new Date().toISOString(),
          solInvested: 0,
        };
      }

      const entries = [...s.entries]; entries[idx] = updated;
      return { ...s, balance: s.balance + returned, entries };
    });
    setSellingId(null);
  }

  function adjustBalance(delta: number) {
    setState(s => {
      const next = s.balance + delta;
      if (next < 0) { alert("Balance cannot go below 0."); return s; }
      return { ...s, balance: next };
    });
    setBalanceDelta("");
    setBalanceModalOpen(false);
  }

  function resetAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setState({ startingBalance: null, balance: 0, entries: [], nextId: 1 });
  }

  // ── Forms state ───────────────────────────────────────────────────────────
  const [formNew, setFormNew] = useState({ name: "", entryMarketCap: "", solInvested: "" });
  const [formEdit, setFormEdit] = useState({ name: "", entryMarketCap: "", solInvested: "" });
  const [formSell, setFormSell] = useState({ sellMarketCap: "", sellAmountValue: "" });
  const [formBuyMore, setFormBuyMore] = useState({ currentMcap: "", buyAmount: "" });

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────

  if (state.startingBalance === null) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-slate-900/60 rounded-2xl shadow-xl p-6 border border-slate-800">
          <div className="flex items-center gap-3 mb-4">
            <Wallet className="w-6 h-6" />
            <h1 className="text-xl font-semibold">Set Starting Balance</h1>
          </div>
          <p className="text-sm text-slate-300 mb-4">Runs entirely in your browser. You can DCA buy/sell; data persists locally.</p>
          <StartingBalanceForm onSet={(n) => setStartingBalance(n)} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center gap-3">
            <Coins className="w-7 h-7" />
            <div>
              <h1 className="text-2xl font-semibold">SOL Paper Trading (DCA enabled)</h1>
              <p className="text-slate-400 text-sm">PnL from market cap changes. DCA buy/sell. Local autosave.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryCard
              label="Balance"
              value={fmtSOL(state.balance)}
              icon={<Wallet className="w-4 h-4" />}
              clickable
              onClick={() => setBalanceModalOpen(true)}
            />
            <SummaryCard label="Open Invested" value={fmtSOL(totals.investedOpen)} icon={<DollarSign className="w-4 h-4" />} />
            <SummaryCard label="Realized P/L" value={fmtSOL(totals.realized)} icon={<DollarSign className="w-4 h-4" />} />
            <SummaryCard label="Win Rate" value={`${winStats.winRate.toFixed(1)}% (${winStats.wins}/${winStats.closed})`} icon={<DollarSign className="w-4 h-4" />} />
            <SummaryCard
  label="Avg Returns (closed)"
  value={`${avgReturns.avgPct.toFixed(2)}% • ${fmtSOL(avgReturns.avgAbs)}`}
  icon={<DollarSign className="w-4 h-4" />}
/>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setFormNew({ name: "", entryMarketCap: "", solInvested: "" }); setShowNew(true); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-500 transition-transform duration-150 hover:-translate-y-0.5 hover:brightness-110 font-medium shadow">
            <Plus className="w-4 h-4" /> New Entry
          </button>
          <button onClick={() => setConfirmReset(true)} className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 transition-transform duration-150 hover:-translate-y-0.5 border border-slate-700 text-slate-200">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          <button
  onClick={() => setGraphOpen(true)}
  className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5"
  title="Show Balance + Open Value graph"
>
  <LineChart className="w-4 h-4" /> Graph
</button>
          <button onClick={() => setShowActiveOnly(v => !v)} className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl border transition-transform duration-150 hover:-translate-y-0.5  " style={{ borderColor: showActiveOnly ? "#22c55e" : "#334155", background: showActiveOnly ? "#052e16" : "#0f172a" }}>
            {showActiveOnly ? "Showing Active Only" : "Show Active Only"}
          </button>
        </div>

        {/* Entries List */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {entriesForList.length === 0 ? (
            <div className="col-span-full text-center text-slate-400 border border-dashed border-slate-800 rounded-2xl p-10">
              {showActiveOnly ? "No active positions." : "No entries yet. Click New Entry to buy your first position."}
            </div>
          ) : (
            entriesForList.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                onEdit={() => { setEditingId(e.id); setFormEdit({ name: e.name, entryMarketCap: String(e.entryMarketCap), solInvested: String(e.solInvested), }); }}
                onSell={() => {
  setSellingId(e.id);
  setFormSell({ sellMarketCap: e.currentMarketCap ? String(e.currentMarketCap) : "", sellAmountValue: "" });
}}
                onBuyMore={() => { setBuyMoreId(e.id); setFormBuyMore({ currentMcap: e.currentMarketCap ? String(e.currentMarketCap) : "", buyAmount: "" }); }}
                onPreview={() => setPreviewEntry(e)}
                onEditMcap={() => { setMcapEditId(e.id); setMcapEditValue(String(e.currentMarketCap ?? e.entryMarketCap)); }}
              />
            ))
          )}
        </section>
      </div>

      {/* Modals */}

      {graphOpen && (
  <GraphModal
    onClose={() => setGraphOpen(false)}
    series={state.history ?? []}
    onAddPoint={() => pushHistoryPoint()}
    onReset={() => setState(s => ({ ...s, history: [] }))}
  />
)}

{showNew && (
  <Modal onClose={() => setShowNew(false)} title="New Entry (Buy)">
    ...
  </Modal>
)}

      {showNew && (
        <Modal onClose={() => setShowNew(false)} title="New Entry (Buy)">
          <EntryForm
            mode="new"
            balance={state.balance}
            values={formNew}
            onChange={setFormNew}
            onSubmit={() => {
              const name = formNew.name.trim();
              const mc = Number(formNew.entryMarketCap);
              const sol = Number(formNew.solInvested);
              if (!name) return alert("Please enter a name.");
              if (!isFinitePos(mc)) return alert("Market cap must be a positive number.");
              if (!isFinitePos(sol)) return alert("SOL invested must be a positive number.");
              addEntry({ name, entryMarketCap: mc, solInvested: sol });
            }}
          />
        </Modal>
      )}

      {editingId && (
        <Modal onClose={() => setEditingId(null)} title={`Edit Entry #${editingId}`}>
          <EntryForm
            mode="edit"
            balance={state.balance}
            values={formEdit}
            onChange={setFormEdit}
            onSubmit={() => {
              const name = formEdit.name.trim();
              const mc = Number(formEdit.entryMarketCap);
              const sol = Number(formEdit.solInvested);
              if (!name) return alert("Please enter a name.");
              if (!isFinitePos(mc)) return alert("Market cap must be a positive number.");
              if (!isFinite(sol) || sol < 0) return alert("SOL invested must be ≥ 0.");
              editEntry(editingId!, { name, entryMarketCap: mc, solInvested: sol });
            }}
          />
        </Modal>
      )}

      {buyMoreId && (
        <Modal onClose={() => setBuyMoreId(null)} title={`Buy More (DCA) #${buyMoreId}`}>
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-slate-300">Current Market Cap</span>
              <input inputMode="decimal" className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., 20000" value={formBuyMore.currentMcap} onChange={(e) => setFormBuyMore({ ...formBuyMore, currentMcap: e.target.value })} />
            </label>
            <label className="block">
              <span className="text-sm text-slate-300">Buy Amount (SOL)</span>
              <input inputMode="decimal" className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., 0.5" value={formBuyMore.buyAmount} onChange={(e) => setFormBuyMore({ ...formBuyMore, buyAmount: e.target.value })} />
            </label>
            {/* Preview new average */}
            <AvgPreview entry={state.entries.find(e => e.id === buyMoreId)!} mcap={Number(formBuyMore.currentMcap)} amount={Number(formBuyMore.buyAmount)} />
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setBuyMoreId(null)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5">Cancel</button>
              <button onClick={() => {
                const m = Number(formBuyMore.currentMcap); const a = Number(formBuyMore.buyAmount);
                if (!isFinitePos(m)) return alert("Current market cap must be a positive number.");
                if (!isFinitePos(a)) return alert("Buy amount must be a positive number.");
                buyMore(buyMoreId!, m, a);
              }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium">
                <Save className="w-4 h-4" /> Confirm Buy
              </button>
            </div>
          </div>
        </Modal>
      )}

{sellingId && (() => {
  const entry = state.entries.find(e => e.id === sellingId)!;
  const mcapNum = Number(formSell.sellMarketCap);
  const multiplier = isFinite(mcapNum) && mcapNum > 0 ? mcapNum / entry.entryMarketCap : 0;
  const currentValue = multiplier ? entry.solInvested * multiplier : 0;

  return (
    <Modal onClose={() => setSellingId(null)} title={`Sell (Value-Based) #${sellingId}`}>
      <div className="space-y-4">
        <label className="block">
          <span className="text-sm text-slate-300">Current New Market Cap</span>
          <input
            inputMode="decimal"
            className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g., 40000"
            value={formSell.sellMarketCap}
            onChange={(e) => setFormSell({ ...formSell, sellMarketCap: e.target.value })}
          />
        </label>

        {multiplier > 0 && (
          <div className="text-sm text-slate-300">
            Your Position: <span className="font-semibold">{fmtSOL(entry.solInvested)}</span> →
            <span className="font-semibold"> {fmtSOL(currentValue)}</span>
          </div>
        )}

        <label className="block">
          <span className="text-sm text-slate-300">Amount to sell (in SOL at current mcap)</span>
          <input
            inputMode="decimal"
            className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder={multiplier > 0 ? `max ${currentValue.toFixed(4)}` : "enter market cap first"}
            value={formSell.sellAmountValue}
            onChange={(e) => setFormSell({ ...formSell, sellAmountValue: e.target.value })}
            disabled={!(multiplier > 0)}
          />
          {multiplier > 0 && (
            <div className="text-xs text-slate-400 mt-1">Max: {currentValue.toFixed(4)} SOL</div>
          )}
        </label>

        <SellPreview entry={entry} mcap={mcapNum} amountValue={Number(formSell.sellAmountValue)} />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => multiplier > 0 && setFormSell(fs => ({ ...fs, sellAmountValue: String(currentValue) }))}
            className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5"
            title="Auto-fill full value"
            disabled={!(multiplier > 0)}
          >
            Sell All
          </button>
          <button onClick={() => setSellingId(null)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5">
            Cancel
          </button>
          <button
            onClick={() => {
              const m = Number(formSell.sellMarketCap);
              const val = Number(formSell.sellAmountValue);
              if (!isFinite(m) || m <= 0) return alert("Market cap must be a positive number.");
              if (!isFinite(val) || val <= 0) return alert("Sell amount must be a positive number.");
              const mult = m / entry.entryMarketCap;
              const baseToSell = val / mult; // convert value-SOL back to base SOL
              if (baseToSell > entry.solInvested + 1e-12) return alert("Sell amount exceeds position.");
              updateCurrentMcap(sellingId!, m);
              partialSell(sellingId!, m, baseToSell);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium"
          >
            <Save className="w-4 h-4" /> Confirm Sell
          </button>
        </div>
      </div>
    </Modal>
  );
})()}

      {balanceModalOpen && (
        <Modal onClose={() => setBalanceModalOpen(false)} title="Adjust Balance">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-slate-300">Add/Remove (SOL)</span>
              <input inputMode="decimal" className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., 1 (add) or -0.5 (remove)" value={balanceDelta} onChange={(e) => setBalanceDelta(e.target.value)} />
            </label>
            <div className="text-xs text-slate-400">Current: {fmtSOL(state.balance)}</div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setBalanceModalOpen(false)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5">Cancel</button>
              <button onClick={() => { const d = Number(balanceDelta); if (!isFinite(d)) return alert("Enter a valid number."); adjustBalance(d); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium">
                <Save className="w-4 h-4" /> Apply
              </button>
            </div>
          </div>
        </Modal>
      )}

      {mcapEditId && (() => {
        const entry = state.entries.find(e => e.id === mcapEditId)!;
        return (
          <Modal onClose={() => setMcapEditId(null)} title={`Update Market Cap • ${entry.name}`}>
            <div className="space-y-4">
              <label className="block">
                <span className="text-sm text-slate-300">Current Market Cap</span>
                <input
                  inputMode="decimal"
                  className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="e.g., 20000"
                  value={mcapEditValue}
                  onChange={(e) => setMcapEditValue(e.target.value)}
                />
              </label>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => setMcapEditId(null)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5">Cancel</button>
                <button onClick={() => { const n = Number(mcapEditValue); if (!isFinitePos(n)) return alert("Enter a positive number."); updateCurrentMcap(mcapEditId!, n); setMcapEditId(null); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium">
                  <Save className="w-4 h-4" /> Save
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {previewEntry && (
        <ExportPreview entry={previewEntry} onClose={() => setPreviewEntry(null)} />
      )}

      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)} title="Reset All Data?">
          <p className="text-slate-300 mb-4">Clears balance, entries, and starting balance. Also removes saved session.</p>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setConfirmReset(false)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5">Cancel</button>
            <button onClick={resetAll} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium">Reset</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// UI Bits
// ────────────────────────────────────────────────────────────────────────────────

function GraphModal({
  onClose,
  series,
  onAddPoint,
  onReset,
}: {
  onClose: () => void;
  series: HistoryPoint[];
  onAddPoint: () => void;
  onReset: () => void;
}) {
  const w = 680, h = 260, pad = 28;

  if (!series || series.length === 0) {
    return (
      <Modal title="Balance & Open Value" onClose={onClose}>
        <div className="text-slate-300">No data yet. Make a trade or click “Add point now”.</div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onAddPoint} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:-translate-y-0.5 transition">
            <PlusCircle className="w-4 h-4" /> Add point now
          </button>
        </div>
      </Modal>
    );
  }

  const tmin = series[0].t;
  const tmax = series[series.length - 1].t || series[0].t + 1;
  const vmin = Math.min(...series.flatMap(p => [p.balance, p.openValue]));
  const vmax = Math.max(...series.flatMap(p => [p.balance, p.openValue]));
  const x = (t: number) => pad + ((t - tmin) / (tmax - tmin || 1)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - vmin) / (vmax - vmin || 1)) * (h - 2 * pad);
  const path = (vals: (p: HistoryPoint) => number) =>
    series.map((p, i) => `${i ? "L" : "M"} ${x(p.t)} ${y(vals(p))}`).join(" ");

  return (
    <Modal title="Balance & Open Value" onClose={onClose}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-slate-400">
          Points: <span className="text-slate-200 font-medium">{series.length}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAddPoint}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 hover:-translate-y-0.5 transition"
            title="Append a snapshot now"
          >
            <PlusCircle className="w-4 h-4" /> Add point now
          </button>
          <button
            onClick={onReset}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-red-600 hover:bg-red-500 transition"
            title="Clear graph series"
          >
            <Trash2 className="w-4 h-4" /> Reset series
          </button>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg width={w} height={h} className="rounded-xl border border-slate-800 bg-slate-950">
        <div className="mt-3 text-xs text-slate-400 flex gap-6 justify-center">
  <div className="flex items-center gap-2">
    <span className="inline-block w-3 h-3 rounded" style={{ background: "#60a5fa" }} />
    Balance
  </div>
  <div className="flex items-center gap-2">
    <span className="inline-block w-3 h-3 rounded" style={{ background: "#34d399" }} />
    Open Value
  </div>
</div>
        {/* axes */}
<line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#334155" strokeWidth="1" />
<line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#334155" strokeWidth="1" />

{/* X-axis ticks (time) */}
{series.map((p, i) => (
  i % Math.ceil(series.length / 5) === 0 && (
    <text
      key={`xtick-${i}`}
      x={x(p.t)}
      y={h - pad + 15}
      fontSize="10"
      fill="#94a3b8"
      textAnchor="middle"
    >
      {new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </text>
  )
))}

{/* Y-axis ticks (values) */}
{[0, 0.25, 0.5, 0.75, 1].map((frac, i) => {
  const val = vmin + (vmax - vmin) * frac;
  return (
    <g key={`ytick-${i}`}>
      <line
        x1={pad - 4}
        y1={y(val)}
        x2={pad}
        y2={y(val)}
        stroke="#334155"
        strokeWidth="1"
      />
      <text
        x={pad - 6}
        y={y(val) + 3}
        fontSize="10"
        fill="#94a3b8"
        textAnchor="end"
      >
        {val.toFixed(2)}
      </text>
    </g>
  );
})}
          {/* axes */}
          <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#334155" strokeWidth="1" />
          <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#334155" strokeWidth="1" />
          {/* lines */}
          <path d={path(p => p.balance)} fill="none" stroke="#60a5fa" strokeWidth="2" />
          <path d={path(p => p.openValue)} fill="none" stroke="#34d399" strokeWidth="2" />
          {/* last dots */}
          {series.length > 0 && (
            <>
              <circle cx={x(series[series.length - 1].t)} cy={y(series[series.length - 1].balance)} r="3" fill="#60a5fa" />
              <circle cx={x(series[series.length - 1].t)} cy={y(series[series.length - 1].openValue)} r="3" fill="#34d399" />
            </>
          )}
        </svg>
      </div>

      <div className="mt-3 text-xs text-slate-400 flex gap-4">
        <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded" style={{ background: "#60a5fa" }} /> Balance</div>
        <div className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded" style={{ background: "#34d399" }} /> Open Value</div>
      </div>
    </Modal>
  );
}


function SummaryCard({ label, value, icon, clickable, onClick }: { label: string; value: string; icon: React.ReactNode; clickable?: boolean; onClick?: () => void }) {
  const cls = "px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-sm flex items-center gap-2 " + (clickable ? "cursor-pointer transition-transform duration-150 hover:-translate-y-0.5 hover:brightness-110" : "");
  return (
    <div className={cls} onClick={onClick} title={clickable ? "Click to edit" : undefined}>
      <div className="p-1 rounded-lg bg-slate-800">{icon}</div>
      <div>
        <div className="text-slate-400">{label}</div>
        <div className="font-semibold whitespace-normal break-words leading-snug">
  {value}
</div>
      </div>
    </div>
  );
}

function EntryCard({
  entry,
  onEdit,
  onSell,
  onPreview,
  onBuyMore,
  onEditMcap,
}: {
  entry: Entry;
  onEdit: () => void;
  onSell: () => void;
  onPreview: () => void;
  onBuyMore: () => void;
  onEditMcap: () => void;
}) {
  const sold = entry.status === "sold";
  const pnlColor = sold
    ? (entry.pnl ?? 0) > 0
      ? "text-green-400"
      : (entry.pnl ?? 0) < 0
      ? "text-red-400"
      : ""
    : "";

  // Current MCAP
  const hasCurrent = isFinite(entry.currentMarketCap ?? NaN);
  const curMcap = hasCurrent
    ? (entry.currentMarketCap as number)
    : entry.entryMarketCap;
  const changePct =
    ((curMcap - entry.entryMarketCap) / entry.entryMarketCap) * 100;
  const changeColor =
    changePct > 0
      ? "text-green-400"
      : changePct < 0
      ? "text-red-400"
      : "text-slate-300";

  // 📊 Open Invested (value, delta, %)
  const baseSOL = entry.solInvested;
  const multiplierNow = curMcap / entry.entryMarketCap;
  const valueNowSOL = baseSOL * multiplierNow; // what it's worth now
  const deltaAbsSOL = valueNowSOL - baseSOL;
  const deltaPct = (multiplierNow - 1) * 100;
  const deltaClr = deltaAbsSOL >= 0 ? "text-green-400" : "text-red-400";
  const signAbs = deltaAbsSOL >= 0 ? "+" : "";
  const signPct = deltaPct >= 0 ? "+" : "";

  return (
    <div
      className={
        "rounded-2xl border p-4 transition shadow-sm " +
        (sold
          ? "bg-slate-900/40 border-slate-900 text-slate-400"
          : "bg-slate-900/70 border-slate-800")
      }
    >
      <div className="flex items-center justify-between">
        <div className="font-semibold text-lg truncate">{entry.name}</div>
        <div className="flex items-center gap-2">
          {sold && (
            <button
              onClick={onPreview}
              className="p-2 rounded-lg hover:bg-slate-800 transition-transform duration-150 hover:-translate-y-0.5"
              title="Export image"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <div className="text-xs text-slate-400">#{entry.id}</div>
        </div>
      </div>

      {/* Big current MCAP row */}
      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="text-xs text-slate-400">Current Market Cap</div>
          <div className="text-2xl font-extrabold tracking-tight">
            {fmtNum(curMcap)}
          </div>
          <div className={`text-xs ${changeColor}`}>
            {changePct >= 0 ? "+" : ""}
            {changePct.toFixed(2)}% since entry
          </div>
        </div>
        {!sold && (
          <button
            onClick={onEditMcap}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
        <KV label="Avg Entry Mcap" value={fmtNum(entry.entryMarketCap)} />

        {/* ✅ Open Invested with value + delta */}
        <div className="col-span-2 md:col-span-2">
          <KV
            label="Open Invested"
            value={
              <span>
                {valueNowSOL.toFixed(4)}{" "}
                <span className={deltaClr}>
                  ({signAbs}
                  {Math.abs(deltaAbsSOL).toFixed(4)}) ({signPct}
                  {deltaPct.toFixed(2)}%)
                </span>
              </span>
            }
          />
        </div>

        {sold ? (
          <>
            <KV label="Last Sell Mcap" value={fmtNum(entry.sellMarketCap ?? 0)} />
            <KV
              label="Returned (total)"
              value={fmtSOL(entry.solReturned ?? 0)}
            />
            <KV
              label="% (total)"
              value={
                <span className={pnlColor}>
                  {(entry.pnlPercent ?? 0).toFixed(2)}%
                </span>
              }
            />
            <KV
              label="P/L (total)"
              value={
                <span className={pnlColor}>{fmtSOL(entry.pnl ?? 0)}</span>
              }
            />
            <KV
              label="Sold"
              value={entry.soldAt ? new Date(entry.soldAt).toLocaleString() : ""}
            />
          </>
        ) : (
          <>
            <KV label="Realized P/L" value={fmtSOL(entry.realizedPnl ?? 0)} />
            <KV
              label="Buys (SOL)"
              value={fmtSOL(entry.cumulativeBuySOL ?? entry.solInvested)}
            />
          </>
        )}
      </div>

      {/* Buttons */}
      <div className="mt-4 flex flex-wrap gap-2">
        {sold ? (
          <span className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">
            Sold • locked
          </span>
        ) : (
          <>
            <button
              onClick={onBuyMore}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium"
            >
              Buy More
            </button>
            <button
              onClick={onSell}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium"
            >
              Sell
            </button>
            <button
              onClick={onEdit}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5"
            >
              <Pencil className="w-4 h-4" /> Edit
            </button>
          </>
        )}
      </div>
    </div>
  );
}


function KV({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-slate-950/40 rounded-xl border border-slate-800 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-medium whitespace-normal break-words leading-snug">
        {value}
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 transition-transform duration-150 hover:-translate-y-0.5" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EntryForm({ mode, balance, values, onChange, onSubmit }: { mode: "new" | "edit"; balance: number; values: { name: string; entryMarketCap: string; solInvested: string }; onChange: (v: { name: string; entryMarketCap: string; solInvested: string }) => void; onSubmit: () => void; }) {
  const canAfford = (() => { const sol = Number(values.solInvested); if (!isFinite(sol)) return false; return sol <= balance || mode === "edit"; })();
  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-300">Wallet Balance: <span className="font-semibold">{fmtSOL(balance)}</span></div>
      <div className="grid grid-cols-1 gap-3">
        <label className="block"><span className="text-sm text-slate-300">Name</span>
          <input className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., DONUT COIN" value={values.name} onChange={(e) => onChange({ ...values, name: e.target.value })} />
        </label>
        <label className="block"><span className="text-sm text-slate-300">Market Cap at Entry</span>
          <input inputMode="decimal" className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., 14000" value={values.entryMarketCap} onChange={(e) => onChange({ ...values, entryMarketCap: e.target.value })} />
        </label>
        <label className="block"><span className="text-sm text-slate-300">Amount of SOL to Invest</span>
          <input inputMode="decimal" className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., 1" value={values.solInvested} onChange={(e) => onChange({ ...values, solInvested: e.target.value })} />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 transition-transform duration-150 hover:-translate-y-0.5" onClick={onSubmit} disabled={!canAfford}>
          {mode === "new" ? "Add Entry / Buy" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

function StartingBalanceForm({ onSet }: { onSet: (n: number) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="space-y-3">
      <label className="block"><span className="text-sm text-slate-300">Starting SOL</span>
        <input inputMode="decimal" className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g., 10" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const n = Number(v); if (!isFinitePos(n)) return alert("Please enter a positive number."); onSet(n); } }} />
      </label>
      <button onClick={() => { const n = Number(v); if (!isFinitePos(n)) return alert("Please enter a positive number."); onSet(n); }} className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition-transform duration-150 hover:-translate-y-0.5 font-medium">
        <Save className="w-4 h-4" /> Save & Start
      </button>
    </div>
  );
}

function AvgPreview({ entry, mcap, amount }: { entry: Entry; mcap: number; amount: number }) {
  if (!isFinite(mcap) || !isFinite(amount) || amount <= 0) return null;
  const curInv = entry.solInvested;
  const newAvg = (entry.entryMarketCap * curInv + mcap * amount) / (curInv + amount);
  return (
    <div className="text-sm text-slate-300">Your New Average Entry: <span className="font-semibold">{fmtNum(newAvg)}</span></div>
  );
}

function SellPreview({ entry, mcap, amountValue }: { entry: Entry; mcap: number; amountValue: number }) {
  if (!isFinite(mcap) || mcap <= 0) return null;
  const multiplier = mcap / entry.entryMarketCap;
  const currentValue = entry.solInvested * multiplier; // value SOL at current mcap

  if (!isFinite(amountValue) || amountValue <= 0) {
    return (
      <div className="text-sm text-slate-300">
        Current position value: <span className="font-semibold">{fmtSOL(currentValue)}</span>
      </div>
    );
  }

  if (amountValue > currentValue + 1e-12)
    return <div className="text-sm text-red-400">Sell amount exceeds current position value.</div>;

  const baseToSell = amountValue / multiplier; // convert value-SOL back to base SOL
  const returned = amountValue;                 // you receive value SOL
  const pnl = returned - baseToSell;
  const leftValue = currentValue - amountValue;
  const color = pnl >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="text-sm text-slate-300 space-y-1">
      <div>Current position value: <span className="font-semibold">{fmtSOL(currentValue)}</span></div>
      <div>Base to sell: <span className="font-semibold">{fmtSOL(baseToSell)}</span> • Return: <span className="font-semibold">{fmtSOL(returned)}</span> • P/L: <span className={`font-semibold ${color}`}>{fmtSOL(pnl)}</span></div>
      <div>You will be left with: <span className="font-semibold">{fmtSOL(leftValue)}</span></div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Export Preview (Styled Share Image)
// ────────────────────────────────────────────────────────────────────────────────

function ExportPreview({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const previewRef = useRef<HTMLDivElement>(null);

  function downloadImage() {
    if (!previewRef.current) return;
    html2canvas(previewRef.current).then((canvas) => {
      const link = document.createElement("a");
      link.download = `${entry.name}-summary.png`;
      link.href = canvas.toDataURL();
      link.click();
    });
  }

  const positive = (entry.pnl ?? 0) >= 0;
  const pnlColor = positive ? "text-green-400" : "text-red-400";
  const sign = positive ? "+" : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="relative bg-slate-950 p-6 rounded-2xl max-w-md w-full border border-slate-800">
        <button onClick={onClose} className="absolute top-3 right-3 p-2 hover:bg-slate-800 rounded transition-transform duration-150 hover:-translate-y-0.5" title="Close">
          <X />
        </button>

        {/* Capture Target */}
        <div ref={previewRef} className="rounded-2xl overflow-hidden shadow-2xl" style={{ width: 640 }}>
          <div className="bg-gradient-to-br from-purple-600 via-slate-900 to-blue-600 text-white p-8">
            <div className="text-sm opacity-80">PaperTrade • Summary</div>
            <div className="mt-1 text-2xl font-bold tracking-tight">{entry.name}</div>

            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white/5 rounded-xl p-4"><div className="opacity-70">Avg Entry</div><div className="text-lg font-semibold">{fmtNum(entry.entryMarketCap)}</div></div>
              <div className="bg-white/5 rounded-xl p-4"><div className="opacity-70">Total Returned</div><div className="text-lg font-semibold">{fmtSOL(entry.solReturned ?? 0)}</div></div>
              <div className="bg-white/5 rounded-xl p-4"><div className="opacity-70">Buys (SOL)</div><div className="text-lg font-semibold">{fmtSOL(entry.cumulativeBuySOL ?? 0)}</div></div>
              <div className="bg-white/5 rounded-xl p-4"><div className="opacity-70">Last Sell Mcap</div><div className="text-lg font-semibold">{fmtNum(entry.sellMarketCap ?? 0)}</div></div>
            </div>

            <div className="mt-8 text-center">
              <div className={`text-5xl font-extrabold ${pnlColor}`}>{sign}{(entry.pnlPercent ?? 0).toFixed(2)}%</div>
              <div className="mt-2 text-white/80">P/L: {fmtSOL(entry.pnl ?? 0)}</div>
              <div className="mt-1 text-xs text-white/60">{entry.soldAt ? new Date(entry.soldAt).toLocaleString() : ""}</div>
            </div>
          </div>
        </div>

        <button onClick={downloadImage} className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 py-2 rounded-xl inline-flex items-center justify-center gap-2 transition-transform duration-150 hover:-translate-y-0.5">
          <Download className="w-4 h-4" /> Download Image
        </button>
      </div>
    </div>
  );
}
