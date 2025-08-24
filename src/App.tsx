import React, { useEffect, useMemo, useState, useRef } from "react";
import {
  Plus,
  Wallet,
  Coins,
  Pencil,
  Trash2,
  CircleDollarSign,
  Save,
  X,
  RotateCcw,
  DollarSign,
  ExternalLink,
  Download,
} from "lucide-react";
import html2canvas from "html2canvas";

// ────────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "sol-paper-trading-state-v1";

function saveState(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

type Entry = {
  id: string;
  name: string;
  entryMarketCap: number; // at buy
  solInvested: number; // SOL used to buy
  status: "open" | "sold";
  // Sell-related
  sellMarketCap?: number;
  multiplier?: number;
  solReturned?: number;
  pnl?: number; // SOL
  pnlPercent?: number; // %
  soldAt?: string; // ISO
};

type AppState = {
  startingBalance: number | null;
  balance: number;
  entries: Entry[];
  nextId: number;
};

// IMPORTANT: No persistence (resets on refresh/reopen)
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { startingBalance: null, balance: 0, entries: [], nextId: 1 };
    const parsed = JSON.parse(raw);
    // minimal shape check
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.balance !== "number" ||
      !Array.isArray(parsed.entries) ||
      typeof parsed.nextId !== "number"
    ) {
      return { startingBalance: null, balance: 0, entries: [], nextId: 1 };
    }
    return parsed as AppState;
  } catch {
    return { startingBalance: null, balance: 0, entries: [], nextId: 1 };
  }
}

function fmtSOL(n: number) {
  return `${n.toFixed(4)} SOL`;
}

function fmtNum(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(n);
}

function isFinitePos(n: any) {
  return typeof n === "number" && isFinite(n) && n > 0;
}

// ────────────────────────────────────────────────────────────────────────────────
// App
// ────────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState());

  // UI state
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [sellingId, setSellingId] = useState<string | null>(null);
  const [previewEntry, setPreviewEntry] = useState<Entry | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const openEntries = useMemo(() => state.entries.filter(e => e.status === "open"), [state.entries]);
  const soldEntries = useMemo(() => state.entries.filter(e => e.status === "sold"), [state.entries]);

    useEffect(() => {
    saveState(state);
  }, [state]);
  
  const totals = useMemo(() => {
    const investedOpen = openEntries.reduce((s, e) => s + e.solInvested, 0);
    const realized = soldEntries.reduce((s, e) => s + (e.pnl ?? 0), 0);
    return { investedOpen, realized };
  }, [openEntries, soldEntries]);

  // ── Actions ───────────────────────────────────────────────────────────────
  function setStartingBalance(n: number) {
    setState({ startingBalance: n, balance: n, entries: [], nextId: 1 });
  }

  function addEntry(data: { name: string; entryMarketCap: number; solInvested: number }) {
    setState(s => {
      if (s.balance < data.solInvested) {
        alert("Insufficient balance.");
        return s;
      }
      const entry: Entry = {
        id: String(s.nextId),
        name: data.name.trim() || `Entry #${s.nextId}`,
        entryMarketCap: data.entryMarketCap,
        solInvested: data.solInvested,
        status: "open",
      };
      return {
        ...s,
        balance: s.balance - data.solInvested,
        entries: [entry, ...s.entries],
        nextId: s.nextId + 1,
      };
    });
    setShowNew(false);
  }

  function editEntry(id: string, updates: Partial<Pick<Entry, "name" | "entryMarketCap" | "solInvested">>) {
    setState(s => {
      const idx = s.entries.findIndex(e => e.id === id);
      if (idx === -1) return s;
      const e = s.entries[idx];
      if (e.status !== "open") return s;

      let newBalance = s.balance;
      const updated: Entry = { ...e };

      if (typeof updates.name === "string") updated.name = updates.name;
      if (typeof updates.entryMarketCap === "number" && isFinitePos(updates.entryMarketCap)) {
        updated.entryMarketCap = updates.entryMarketCap;
      }
      if (typeof updates.solInvested === "number" && isFinite(updates.solInvested)) {
        const delta = updates.solInvested - e.solInvested;
        if (delta > 0 && s.balance < delta) {
          alert("Insufficient balance to increase position size.");
          return s;
        }
        updated.solInvested = Math.max(0, updates.solInvested);
        newBalance -= delta; // if delta negative, balance refunds
      }

      const entries = [...s.entries];
      entries[idx] = updated;
      return { ...s, balance: newBalance, entries };
    });
    setEditingId(null);
  }

  function sellEntry(id: string, sellMarketCap: number) {
    setState(s => {
      const idx = s.entries.findIndex(e => e.id === id);
      if (idx === -1) return s;
      const e = s.entries[idx];
      if (e.status !== "open") return s;

      const multiplier = sellMarketCap / e.entryMarketCap;
      const solReturned = e.solInvested * multiplier;
      const pnl = solReturned - e.solInvested;
      const pnlPercent = (pnl / e.solInvested) * 100;

      const sold: Entry = {
        ...e,
        status: "sold",
        sellMarketCap,
        multiplier,
        solReturned,
        pnl,
        pnlPercent,
        soldAt: new Date().toISOString(),
      };

      const entries = [...s.entries];
      entries[idx] = sold;
      return { ...s, balance: s.balance + solReturned, entries };
    });
    setSellingId(null);
  }

  function deleteOpenEntry(id: string) {
    setState(s => {
      const e = s.entries.find(x => x.id === id);
      if (!e || e.status !== "open") return s;
      return { ...s, balance: s.balance + e.solInvested, entries: s.entries.filter(x => x.id !== id) };
    });
  }

function resetAll() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  setState({ startingBalance: null, balance: 0, entries: [], nextId: 1 });
}

  // ── Forms state ───────────────────────────────────────────────────────────
  const [formNew, setFormNew] = useState({ name: "", entryMarketCap: "", solInvested: "" });
  const [formEdit, setFormEdit] = useState({ name: "", entryMarketCap: "", solInvested: "" });
  const [formSell, setFormSell] = useState({ sellMarketCap: "" });

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
          <p className="text-sm text-slate-300 mb-4">This app runs entirely in your browser. Choose your starting SOL balance to begin.</p>
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
              <h1 className="text-2xl font-semibold">SOL Paper Trading (Offline logic, hosted)</h1>
              <p className="text-slate-400 text-sm">PnL from market cap changes. State resets on refresh/reopen.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SummaryCard label="Balance" value={fmtSOL(state.balance)} icon={<Wallet className="w-4 h-4" />} />
            <SummaryCard label="Open Invested" value={fmtSOL(totals.investedOpen)} icon={<CircleDollarSign className="w-4 h-4" />} />
            <SummaryCard label="Realized P/L" value={fmtSOL(totals.realized)} icon={<DollarSign className="w-4 h-4" />} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setFormNew({ name: "", entryMarketCap: "", solInvested: "" });
              setShowNew(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-indigo-600 hover:bg-indigo-500 transition font-medium shadow"
          >
            <Plus className="w-4 h-4" /> New Entry
          </button>

          <button
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
          >
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
        </div>

        {/* Entries List */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {state.entries.length === 0 ? (
            <div className="col-span-full text-center text-slate-400 border border-dashed border-slate-800 rounded-2xl p-10">
              No entries yet. Click <span className="font-semibold">New Entry</span> to buy your first position.
            </div>
          ) : (
            state.entries.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                onEdit={() => {
                  setEditingId(e.id);
                  setFormEdit({
                    name: e.name,
                    entryMarketCap: String(e.entryMarketCap),
                    solInvested: String(e.solInvested),
                  });
                }}
                onDelete={() => deleteOpenEntry(e.id)}
                onSell={() => {
                  setSellingId(e.id);
                  setFormSell({ sellMarketCap: e.sellMarketCap ? String(e.sellMarketCap) : "" });
                }}
                onPreview={() => setPreviewEntry(e)}
              />
            ))
          )}
        </section>
      </div>

      {/* Modals */}
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
              editEntry(editingId, { name, entryMarketCap: mc, solInvested: sol });
            }}
          />
        </Modal>
      )}

      {sellingId && (
        <Modal onClose={() => setSellingId(null)} title={`Sell Entry #${sellingId}`}>
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-slate-300">New Market Cap</span>
              <input
                inputMode="decimal"
                className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="e.g., 140000"
                value={formSell.sellMarketCap}
                onChange={(e) => setFormSell({ sellMarketCap: e.target.value })}
              />
            </label>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setSellingId(null)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700">Cancel</button>
              <button
                onClick={() => {
                  const sellMC = Number(formSell.sellMarketCap);
                  if (!isFinitePos(sellMC)) return alert("New market cap must be a positive number.");
                  sellEntry(sellingId, sellMC);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-medium"
              >
                <Save className="w-4 h-4" /> Confirm Sell
              </button>
            </div>
          </div>
        </Modal>
      )}

      {previewEntry && (
        <ExportPreview entry={previewEntry} onClose={() => setPreviewEntry(null)} />
      )}

      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)} title="Reset All Data?">
          <p className="text-slate-300 mb-4">This clears balance, entries, and starting balance (remember: no persistence across reloads).</p>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setConfirmReset(false)} className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700">Cancel</button>
            <button onClick={resetAll} className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 font-medium">Reset</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// UI Bits
// ────────────────────────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-sm flex items-center gap-2">
      <div className="p-1 rounded-lg bg-slate-800">{icon}</div>
      <div>
        <div className="text-slate-400">{label}</div>
        <div className="font-semibold">{value}</div>
      </div>
    </div>
  );
}

function EntryCard({ entry, onEdit, onSell, onDelete, onPreview }: { entry: Entry; onEdit: () => void; onSell: () => void; onDelete: () => void; onPreview: () => void }) {
  const sold = entry.status === "sold";
  const pnlColor = sold ? (entry.pnl! > 0 ? "text-green-400" : entry.pnl! < 0 ? "text-red-400" : "") : "";

  return (
    <div className={"rounded-2xl border p-4 transition shadow-sm " + (sold ? "bg-slate-900/40 border-slate-900 text-slate-400" : "bg-slate-900/70 border-slate-800") }>
      <div className="flex items-center justify-between">
        <div className="font-semibold text-lg truncate">{entry.name}</div>
        <div className="flex items-center gap-2">
          {sold && (
            <button onClick={onPreview} className="p-2 rounded-lg hover:bg-slate-800" title="Export image">
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          <div className="text-xs text-slate-400">#{entry.id}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
        <KV label="Entry Mcap" value={fmtNum(entry.entryMarketCap)} />
        <KV label="Invested" value={fmtSOL(entry.solInvested)} />
        {sold ? (
          <>
            <KV label="Sell Mcap" value={fmtNum(entry.sellMarketCap!)} />
            <KV label="Returned" value={fmtSOL(entry.solReturned!)} />
            <KV label="% Change" value={<span className={pnlColor}>{entry.pnlPercent!.toFixed(2)}%</span>} />
            <KV label="P/L" value={<span className={pnlColor}>{fmtSOL(entry.pnl!)}</span>} />
            <KV label="Sold" value={new Date(entry.soldAt!).toLocaleString()} />
          </>
        ) : (
          <KV label="Status" value="Open" />
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {sold ? (
          <span className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">Sold • locked</span>
        ) : (
          <>
            <button onClick={onEdit} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700">
              <Pencil className="w-4 h-4" /> Edit
            </button>
            <button onClick={onSell} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-medium">
              Sell
            </button>
            <button onClick={onDelete} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800 border border-slate-700">
              <Trash2 className="w-4 h-4" /> Delete
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
      <div className="font-medium truncate" title={typeof value === 'string' ? value : undefined}>{value}</div>
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
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EntryForm({
  mode,
  balance,
  values,
  onChange,
  onSubmit,
}: {
  mode: "new" | "edit";
  balance: number;
  values: { name: string; entryMarketCap: string; solInvested: string };
  onChange: (v: { name: string; entryMarketCap: string; solInvested: string }) => void;
  onSubmit: () => void;
}) {
  const canAfford = (() => {
    const sol = Number(values.solInvested);
    if (!isFinite(sol)) return false;
    return sol <= balance || mode === "edit"; // edit delta validated elsewhere
  })();

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-300">Wallet Balance: <span className="font-semibold">{fmtSOL(balance)}</span></div>
      <div className="grid grid-cols-1 gap-3">
        <label className="block">
          <span className="text-sm text-slate-300">Name</span>
          <input
            className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g., DONUT COIN"
            value={values.name}
            onChange={(e) => onChange({ ...values, name: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Market Cap at Entry</span>
          <input
            inputMode="decimal"
            className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g., 14000"
            value={values.entryMarketCap}
            onChange={(e) => onChange({ ...values, entryMarketCap: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Amount of SOL to Invest</span>
          <input
            inputMode="decimal"
            className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g., 1"
            value={values.solInvested}
            onChange={(e) => onChange({ ...values, solInvested: e.target.value })}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700" onClick={onSubmit} disabled={!canAfford}>
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
      <label className="block">
        <span className="text-sm text-slate-300">Starting SOL</span>
        <input
          inputMode="decimal"
          className="mt-1 w-full rounded-xl bg-slate-900 border border-slate-700 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="e.g., 10"
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = Number(v);
              if (!isFinitePos(n)) return alert("Please enter a positive number.");
              onSet(n);
            }
          }}
        />
      </label>
      <button
        onClick={() => {
          const n = Number(v);
          if (!isFinitePos(n)) return alert("Please enter a positive number.");
          onSet(n);
        }}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium"
      >
        <Save className="w-4 h-4" /> Save & Start
      </button>
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
        <button onClick={onClose} className="absolute top-3 right-3 p-2 hover:bg-slate-800 rounded" title="Close">
          <X />
        </button>

        {/* Capture Target */}
        <div
          ref={previewRef}
          className="rounded-2xl overflow-hidden shadow-2xl"
          style={{ width: 640 }}
        >
          <div className="bg-gradient-to-br from-purple-600 via-slate-900 to-blue-600 text-white p-8">
            <div className="text-sm opacity-80">PaperTrade • Summary</div>
            <div className="mt-1 text-2xl font-bold tracking-tight">{entry.name}</div>

            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <div className="bg-white/5 rounded-xl p-4">
                <div className="opacity-70">Invested</div>
                <div className="text-lg font-semibold">{fmtSOL(entry.solInvested)}</div>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <div className="opacity-70">Returned</div>
                <div className="text-lg font-semibold">{fmtSOL(entry.solReturned ?? 0)}</div>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <div className="opacity-70">Entry Mcap</div>
                <div className="text-lg font-semibold">{fmtNum(entry.entryMarketCap)}</div>
              </div>
              <div className="bg-white/5 rounded-xl p-4">
                <div className="opacity-70">Sell Mcap</div>
                <div className="text-lg font-semibold">{fmtNum(entry.sellMarketCap ?? 0)}</div>
              </div>
            </div>

            <div className="mt-8 text-center">
              <div className={`text-5xl font-extrabold ${pnlColor}`}>{sign}{(entry.pnlPercent ?? 0).toFixed(2)}%</div>
              <div className="mt-2 text-white/80">P/L: {fmtSOL(entry.pnl ?? 0)}</div>
              <div className="mt-1 text-xs text-white/60">{entry.soldAt ? new Date(entry.soldAt).toLocaleString() : ""}</div>
            </div>
          </div>
        </div>

        <button
          onClick={downloadImage}
          className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 py-2 rounded-xl inline-flex items-center justify-center gap-2"
        >
          <Download className="w-4 h-4" /> Download Image
        </button>
      </div>
    </div>
  );
}
