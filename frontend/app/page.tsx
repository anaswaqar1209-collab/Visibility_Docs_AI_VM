"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";

const API = "http://127.0.0.1:8000";

function authFetch(token: string, url: string, opts?: RequestInit) {
  return fetch(url, {
    ...opts,
    headers: { ...opts?.headers, Authorization: `Bearer ${token}` },
  });
}

/* ───────────── helpers ───────────── */

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function statusColor(s: string) {
  const m: Record<string, string> = {
    processed: "badge-success", processing: "badge-info",
    failed: "badge-error", uploaded: "badge-ghost",
    classified: "badge-primary", ocr_done: "badge-warning",
    embedded: "badge-accent", extracting: "badge-warning",
    queued: "badge-ghost",
  };
  return m[s] || "badge-ghost";
}

function typeColor(t: string) {
  const m: Record<string, string> = {
    invoice: "badge-secondary", contract: "badge-primary",
    report: "badge-accent", resume: "badge-info",
    cv: "badge-info", transcript: "badge-accent",
    other: "badge-ghost",
  };
  return m[t] || "badge-ghost";
}

const NavItem = ({ icon, label, active, onClick }: any) => (
  <button onClick={onClick}
    className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200
      ${active ? "bg-white/10 text-white shadow-sm" : "text-white/60 hover:text-white hover:bg-white/5"}`}>
    <span className="text-lg">{icon}</span>
    <span className="font-medium text-sm">{label}</span>
  </button>
);

const TypingDots = () => (
  <div className="flex gap-1.5 items-center px-1">
    {[1, 2, 3].map(i => <span key={i} className="w-2 h-2 rounded-full bg-indigo-400 bounce-dot" />)}
  </div>
);

/* ───────────── main page ───────────── */
export default function Home() {
  const router = useRouter();
  const { orgId, token, loading, user, logout } = useAuth();
  const [tab, setTab] = useState<"chat" | "docs">("chat");
  const [toast, setToast] = useState("");
  const [selectedChatDocs, setSelectedChatDocs] = useState<any[]>([]);

  const showToast = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  if (loading) return <div className="h-screen flex items-center justify-center bg-gradient-surface"><div className="spinner-sm" /></div>;
  if (!user) return null;

  return (
    <div className="h-screen flex flex-col bg-gradient-surface">
      {/* ── header ── */}
      <header className="shrink-0 glass border-b border-slate-200/50 z-30">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gradient tracking-tight">Visibility Docs AI</h1>
              <p className="text-[11px] text-slate-400 -mt-0.5">Enterprise Document Intelligence</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex gap-1 p-1 bg-slate-100/80 rounded-xl">
              <button onClick={() => setTab("chat")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${tab === "chat" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                💬 Chat
              </button>
              <button onClick={() => setTab("docs")}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200
                  ${tab === "docs" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                📄 Documents
              </button>
            </div>
            <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
              <span className="text-xs text-slate-400 hidden sm:block">{user?.email}</span>
              <button onClick={async () => { await logout(); router.push("/login"); }}
                className="p-2 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                title="Logout">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {tab === "docs" ? (
          <AllDocumentsPage showToast={showToast} orgId={orgId} token={token} />
        ) : (
          <ChatSection showToast={showToast} selectedDocs={selectedChatDocs} setSelectedDocs={setSelectedChatDocs} orgId={orgId} token={token} />
        )}
      </div>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 glass px-6 py-3 rounded-2xl shadow-2xl slide-up">
          <p className="text-sm font-medium text-slate-800">{toast}</p>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   DOCUMENTS
   ════════════════════════════════════════ */
function loadSeen(): Set<string> { try { const r = localStorage.getItem("sc"); return new Set(r ? JSON.parse(r) : []); } catch { return new Set(); } }
function saveSeen(id: string) { try { const r = localStorage.getItem("sc"); const a: string[] = r ? JSON.parse(r) : []; if (!a.includes(id)) { a.push(id); localStorage.setItem("sc", JSON.stringify(a)); } } catch {} }

function AllDocumentsPage({ showToast, orgId, token }: any) {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [classifyQueue, setClassifyQueue] = useState<any[]>([]);
  const classifyQueueRef = useRef<any[]>([]);
  const seen = useRef<Set<string>>(loadSeen());
  const prevDocsRef = useRef<any[]>([]);

  useEffect(() => { load(); const i = setInterval(load, 5000); return () => clearInterval(i); }, []);

  async function load() {
    try {
      const r = await authFetch(token, `${API}/api/v1/documents?q=&limit=200&organization_id=${orgId}`);
      const d = await r.json();
      const newDocs: any[] = d?.documents || d || [];

      const prev = prevDocsRef.current;
      const added: any[] = [];
      if (prev.length > 0) {
        for (const nd of newDocs) {
          if ((nd.status === "classified" || nd.status === "processed" || nd.status === "embedded") &&
              !seen.current.has(nd.id) && nd.document_type) {
            const old = prev.find((p: any) => p.id === nd.id);
            const prevStatus = old?.status || "";
            if (prevStatus !== nd.status && prevStatus !== "") {
              seen.current.add(nd.id); saveSeen(nd.id);
              added.push(nd);
            }
          }
        }
      } else {
        for (const nd of newDocs) {
          if ((nd.status === "classified" || nd.status === "processed" || nd.status === "embedded") &&
              !seen.current.has(nd.id) && nd.document_type) {
            seen.current.add(nd.id); saveSeen(nd.id);
            added.push(nd);
          }
        }
      }
      if (added.length > 0) {
        setTimeout(() => {
          classifyQueueRef.current = [...classifyQueueRef.current, ...added];
          setClassifyQueue([...classifyQueueRef.current]);
        }, 800);
      }

      prevDocsRef.current = newDocs;
      setDocs(newDocs);
    } catch { } finally { setLoading(false); }
  }

  const nextInQueue = () => {
    classifyQueueRef.current.shift();
    setClassifyQueue([...classifyQueueRef.current]);
  };

  const handleTypeChange = async (docId: string, docType: string, phase3Agent: string) => {
    try {
      await authFetch(token, `${API}/api/v1/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_type: docType, phase3_agent: phase3Agent, organization_id: orgId }),
      });
      setDocs(prev => prev.map(d => d.id === docId ? { ...d, document_type: docType, phase3_agent: phase3Agent } : d));
      nextInQueue();
      showToast(`Agent set to "${phase3Agent.replace(/_/g, " ")}" ✅`);
    } catch {
      showToast("Failed to update document settings");
    }
  };

  const filtered = docs.filter((d: any) =>
    (d.title || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* document list */}
      <div className="w-[420px] shrink-0 flex flex-col border-r border-slate-200/50 bg-white">
        <div className="p-4 pb-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400 transition-all"
              placeholder="Search documents..." />
          </div>
        </div>
        <UploadBox onUpload={() => { load(); showToast("Document uploaded successfully ✨"); }} />
        <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
          {loading && [...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
          ))}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p className="text-3xl mb-2">📄</p>
              <p className="text-sm font-medium">No documents yet</p>
              <p className="text-xs mt-1">Upload your first document above</p>
            </div>
          )}
          {filtered.map((doc: any) => (
            <button key={doc.id} onClick={() => setSelected(doc)}
              className={`w-full text-left p-3.5 rounded-xl border transition-all duration-200 card-hover
                ${selected?.id === doc.id ? "border-indigo-300 bg-indigo-50/50 shadow-md shadow-indigo-200/20" : "border-slate-200 bg-white hover:border-slate-300"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm text-slate-800 truncate">{doc.title || "Untitled"}</p>
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    <span className={`badge badge-sm ${typeColor(doc.document_type)}`}>{doc.document_type || "unknown"}</span>
                    <span className={`badge badge-sm ${statusColor(doc.status)}`}>{doc.status}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1.5">{timeAgo(doc.created_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* detail panel */}
      <div className="flex-1 overflow-y-auto bg-gradient-surface p-6">
        {selected ? <DocDetail doc={selected} showToast={showToast} onDelete={() => { setSelected(null); load(); }} /> : (
          <div className="h-full flex items-center justify-center text-slate-300">
            <div className="text-center">
              <p className="text-5xl mb-4">📋</p>
              <p className="text-lg font-medium">Select a document to view details</p>
            </div>
          </div>
        )}
      </div>

      {/* classification popup queue */}
      {classifyQueue.length > 0 && (
        <ClassifyPopup
          key={classifyQueue[0].id}
          doc={classifyQueue[0]}
          queueLen={classifyQueue.length}
          onConfirm={handleTypeChange}
          onDismiss={() => nextInQueue()}
        />
      )}
    </div>
  );
}

/* ─────── doc type → agent mapping ─────── */
const DOC_TYPE_TO_AGENT: Record<string, string> = {
  invoice: "finance_agent",
  financial_statement: "finance_agent",
  purchase_order: "procurement_agent",
  quotation: "procurement_agent",
  hr_document: "hr_agent",
  resume: "hr_agent",
  transcript: "hr_agent",
  contract: "legal_agent",
  sop: "compliance_agent",
  audit_report: "compliance_agent",
  quality_report: "compliance_agent",
  certificate: "compliance_agent",
  maintenance_report: "compliance_agent",
  engineering_drawing: "compliance_agent",
  other: "other_agent",
};

function agentLabel(a: string) {
  const m: Record<string, string> = {
    finance_agent: "💰 Finance Agent",
    procurement_agent: "📦 Procurement Agent",
    hr_agent: "👨‍💼 HR Agent",
    legal_agent: "⚖️ Legal Agent",
    compliance_agent: "✅ Compliance Agent",
    other_agent: "❓ Other Agent",
  };
  return m[a] || a;
}

/* ─────── Classification Popup ─────── */
function ClassifyPopup({ doc, queueLen = 1, onConfirm, onDismiss }: any) {
  const defaultAgent = DOC_TYPE_TO_AGENT[doc.document_type] || "other_agent";
  const [agent, setAgent] = useState(defaultAgent);
  const types = ["finance_agent", "procurement_agent", "hr_agent", "legal_agent", "compliance_agent", "other_agent"];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm fade-in" onClick={onDismiss}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4 border border-slate-200 slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-lg text-slate-800">Classification Result</h3>
              {queueLen > 1 && (
                <span className="badge badge-sm bg-indigo-100 text-indigo-700 border-0 font-semibold">1 of {queueLen}</span>
              )}
            </div>
            <p className="text-sm text-slate-500 truncate max-w-[300px]">{doc.title || "Untitled"}</p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-4 mb-4 border border-indigo-100">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">Detected Type</p>
          <p className="text-lg font-bold text-slate-800">{doc.document_type || "unknown"}</p>
          <p className="text-xs text-slate-500 mt-1">Agent: {agentLabel(defaultAgent)}</p>
        </div>

        <div className="mb-4">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">Change Extraction Agent</label>
          <div className="relative">
            <select value={agent} onChange={e => setAgent(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm appearance-none cursor-pointer outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400 transition-all">
              {types.map(t => <option key={t} value={t}>{agentLabel(t)}</option>)}
            </select>
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={() => onDismiss()}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
            Dismiss
          </button>
          <button onClick={() => onConfirm(doc.id, doc.document_type, agent)}
            className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────── Upload Box ─────── */
function UploadBox({ onUpload }: any) {
  const { orgId, token } = useAuth();
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const pendingIds = useRef<Set<string>>(new Set());

  const addFiles = (list: FileList) => {
    setFiles(prev => [...prev, ...Array.from(list)].slice(0, 5));
  };

  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    const ids: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData();
      fd.append("file", files[i]);
      fd.append("organization_id", orgId);
      try {
        const r = await authFetch(token, `${API}/api/v1/documents/upload`, { method: "POST", body: fd });
        const data = await r.json();
        if (data?.id) ids.push(data.id);
      } catch { }
    }
    ids.forEach(id => pendingIds.current.add(id));
    onUpload?.();

    const poll = setInterval(async () => {
      try {
        const r = await authFetch(token, `${API}/api/v1/documents?q=&limit=200&organization_id=${orgId}`);
        const d = await r.json();
        const allDocs: any[] = d?.documents || d || [];
        const done: string[] = [];
        for (const id of Array.from(pendingIds.current)) {
          const doc = allDocs.find((x: any) => x.id === id);
          if (doc && (doc.status === "embedded" || doc.status === "processed" || doc.status === "classified" || doc.status === "failed" || doc.status === "error")) {
            done.push(id);
          }
        }
        done.forEach(id => pendingIds.current.delete(id));
        if (pendingIds.current.size === 0) {
          clearInterval(poll);
          setUploading(false);
          setFiles([]);
        }
      } catch { }
    }, 3000);
  };

  return (
    <div className="px-3 pb-3">
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all duration-200
          ${drag ? "border-indigo-400 bg-indigo-50/50" : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30"}`}>
        <input ref={ref} type="file" hidden multiple accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.docx,.xlsx,.pptx"
          onChange={e => e.target.files && addFiles(e.target.files)} />
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
            <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-xs font-medium text-slate-600">
            {drag ? "Drop here" : "Drop files or click to upload"}
          </p>
          <p className="text-[10px] text-slate-400">PDF, Images, Office docs</p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {files.map((f, i) => (
            <div key={i} className="relative flex items-center justify-between px-3 py-2 bg-white rounded-lg border border-slate-200 text-xs overflow-hidden">
              <span className="truncate text-slate-700 font-medium">{f.name}</span>
              <span className="text-slate-400 shrink-0 ml-2">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
              {uploading && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-lg">
                  <div className="spinner-sm" />
                </div>
              )}
            </div>
          ))}
          <button onClick={upload} disabled={uploading}
            className="btn btn-primary btn-sm w-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-0 shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 transition-all">
            {uploading ? <><div className="spinner-sm inline-block mr-1.5" /> Uploading...</> : `Upload ${files.length} file${files.length > 1 ? "s" : ""}`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────── Doc Detail ─────── */
function DocDetail({ doc, showToast, onDelete }: any) {
  const { orgId, token } = useAuth();
  const [similar, setSimilar] = useState<any[]>([]);

  useEffect(() => {
    authFetch(token, `${API}/api/v1/search/similar/${doc.id}?organization_id=${orgId}`)
      .then(r => r.json()).then(d => setSimilar(d?.results || d || [])).catch(() => {});
  }, [doc.id]);

  const del = async () => {
    if (!confirm("Delete this document?")) return;
    await authFetch(token, `${API}/api/v1/documents/${doc.id}?organization_id=${orgId}`, { method: "DELETE" });
    showToast("Document deleted");
    onDelete?.();
  };

  return (
    <div className="max-w-2xl slide-up">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{doc.title || "Untitled"}</h2>
          <div className="flex gap-2 mt-2">
            <span className={`badge ${typeColor(doc.document_type)}`}>{doc.document_type || "unknown"}</span>
            <span className={`badge ${statusColor(doc.status)}`}>{doc.status}</span>
          </div>
        </div>
        <button onClick={del} className="btn btn-ghost btn-sm text-red-400 hover:bg-red-50 hover:text-red-500">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          ["File", doc.original_file_url?.split("/").pop() || "—"],
          ["Pages", doc.page_count ?? "—"],
          ["Size", doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : "—"],
          ["Created", doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"],
        ].map(([l, v]) => (
          <div key={l} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{l}</p>
            <p className="text-sm font-semibold text-slate-700 mt-1 truncate">{v}</p>
          </div>
        ))}
      </div>

      {doc.original_file_url && (
        <a href={`${API}/api/v1/documents/${doc.id}/file?organization_id=${orgId}`} target="_blank"
          className="btn btn-outline btn-sm mb-6 border-slate-300 text-slate-600 hover:bg-slate-100">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Open File
        </a>
      )}

      {doc.raw_text && (
        <details className="bg-white rounded-xl border border-slate-200 mb-6 overflow-hidden">
          <summary className="px-4 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors">
            OCR Preview ({doc.raw_text.length.toLocaleString()} chars)
          </summary>
          <div className="max-h-64 overflow-y-auto p-4 bg-slate-50 text-xs text-slate-600 font-mono leading-relaxed whitespace-pre-wrap">
            {doc.raw_text.slice(0, 3000)}
          </div>
        </details>
      )}

      {similar.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Similar Documents</h3>
          <div className="space-y-2">
            {similar.slice(0, 5).map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-4 py-3">
                <span className="text-sm text-slate-700 truncate">{s.document_title || s.document_id?.slice(0, 12)}</span>
                <span className="text-xs text-slate-400 ml-2">{(s.score * 100).toFixed(0)}% match</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   CHAT SECTION
   ════════════════════════════════════════ */
function ChatSection({ showToast, selectedDocs, setSelectedDocs, orgId, token }: any) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [docQuery, setDocQuery] = useState("");
  const [docs, setDocs] = useState<any[]>([]);
  const [sources, setSources] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  useEffect(() => {
    authFetch(token, `${API}/api/v1/chat/sessions?organization_id=${orgId}`)
      .then(r => r.json()).then(d => setSessions(d?.sessions || d || [])).catch(() => {});
  }, []);

  const loadSession = useCallback(async (sid: string) => {
    try {
      const r = await authFetch(token, `${API}/api/v1/chat/sessions/${sid}?organization_id=${orgId}`);
      const d = await r.json();
      const msgs = d?.messages || [];
      setMessages(msgs.map((m: any) => ({ role: m.role, content: m.content })));
      setActiveSessionId(sid);
      setShowSessions(false);
      const storedIds: string[] = d?.document_ids || [];
      if (storedIds.length > 0) {
        const dr = await authFetch(token, `${API}/api/v1/documents?q=&limit=200&organization_id=${orgId}`);
        const dd = await dr.json();
        const allDocs: any[] = dd?.documents || dd || [];
        setSelectedDocs(allDocs.filter((x: any) => storedIds.includes(x.id)));
      } else {
        setSelectedDocs([]);
      }
    } catch { }
  }, []);

  const newSession = () => {
    setMessages([]);
    setActiveSessionId(null);
    setSources([]);
    setSelectedDocs([]);
  };

  const deleteSession = async (sid: string) => {
    await authFetch(token, `${API}/api/v1/chat/sessions/${sid}?organization_id=${orgId}`, { method: "DELETE" });
    setSessions(prev => prev.filter(s => s.id !== sid));
    if (activeSessionId === sid) newSession();
  };

  const searchDocs = async (q: string) => {
    setDocQuery(q);
    if (!q.trim()) { setDocs([]); return; }
    try {
      const r = await authFetch(token, `${API}/api/v1/documents?q=${encodeURIComponent(q)}&limit=10&organization_id=${orgId}`);
      const d = await r.json();
      setDocs(d?.documents || d || []);
    } catch { }
  };

  const toggleDoc = (doc: any) => {
    setSelectedDocs((prev: any[]) =>
      prev.find((d: any) => d.id === doc.id) ? prev.filter((d: any) => d.id !== doc.id) : [...prev, doc]
    );
    setDocQuery("");
    setDocs([]);
  };

  const send = async () => {
    const q = question.trim();
    if (!q || loading) return;
    setQuestion("");
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setLoading(true);
    setSources([]);

    try {
      const docIds = selectedDocs.map((d: any) => d.id);
      const body: any = { question: q, organization_id: orgId, document_ids: docIds };
      if (activeSessionId) body.session_id = activeSessionId;

      const r = await authFetch(token, `${API}/api/v1/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();

      setMessages(prev => [...prev, { role: "assistant", content: data.answer }]);
      if (data.session_id) setActiveSessionId(data.session_id);
      if (data.sources) setSources(data.sources);

      authFetch(token, `${API}/api/v1/chat/sessions?organization_id=${orgId}`)
        .then(r => r.json()).then(d => setSessions(d?.sessions || d || [])).catch(() => {});

    } catch { setMessages(prev => [...prev, { role: "assistant", content: "⚠️ Connection error. Please check the backend." }]); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* sessions sidebar */}
      {showSessions && (
        <div className="w-72 shrink-0 border-r border-slate-200/50 bg-white flex flex-col">
          <div className="p-4 border-b border-slate-100">
            <button onClick={newSession}
              className="btn btn-primary btn-sm w-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white border-0 shadow-md">
              + New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {sessions.map((s: any) => (
              <div key={s.id}
                className={`group flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all
                  ${activeSessionId === s.id ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50 text-slate-600"}`}
                onClick={() => loadSession(s.id)}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{s.title || "New Chat"}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(s.updated_at || s.created_at)}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 rounded-lg transition-all">
                  <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* main chat area */}
      <div className="flex-1 flex flex-col bg-white">
        {/* top bar */}
        <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <button onClick={() => setShowSessions(!showSessions)}
            className="btn btn-ghost btn-sm btn-square text-slate-400 hover:text-slate-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="relative flex-1 max-w-md">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input value={docQuery} onChange={e => searchDocs(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400/30 focus:border-indigo-400 transition-all"
              placeholder="Search & attach documents..." />
            {docs.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl z-10 overflow-hidden">
                {docs.map((doc: any) => (
                  <button key={doc.id} onClick={() => toggleDoc(doc)}
                    className="flex items-center justify-between w-full px-4 py-3 text-sm hover:bg-slate-50 transition-colors">
                    <span className="truncate text-slate-700">{doc.title || "Untitled"}</span>
                    <span className={`badge badge-sm ${typeColor(doc.document_type)}`}>{doc.document_type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeSessionId && (
            <button onClick={newSession} className="btn btn-ghost btn-sm text-slate-400 hover:text-indigo-500">
              + New
            </button>
          )}
        </div>

        {/* selected docs chips */}
        {selectedDocs.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-5 py-2 bg-indigo-50/40 border-b border-indigo-100/50">
            <span className="text-[11px] font-semibold text-indigo-500 uppercase tracking-wider">Context:</span>
            {selectedDocs.map((d: any) => (
              <span key={d.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-xs font-medium text-indigo-700 shadow-sm">
                {d.title || d.id.slice(0, 8)}
                <button onClick={() => toggleDoc(d)} className="hover:text-red-500 transition-colors">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
            <button onClick={() => setSelectedDocs([])} className="text-[11px] text-slate-400 hover:text-red-400 ml-auto transition-colors">
              Clear
            </button>
          </div>
        )}

        {/* messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.length === 0 && !loading && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/20">
                  <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-700 mb-2">How can I help you?</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Ask questions about your documents. Select documents from the search bar above to narrow the context.
                </p>
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} message-appear`}>
              <div className={`max-w-[75%] ${m.role === "user" ? "order-1" : "order-1"}`}>
                {m.role === "user" ? (
                  <div className="px-4 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20">
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center shadow-md shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                      </svg>
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200/60 shadow-sm">
                      <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start message-appear">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-xl gradient-primary flex items-center justify-center shadow-md shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                  </svg>
                </div>
                <div className="px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-200/60 shadow-sm">
                  <TypingDots />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* sources */}
        {sources.length > 0 && (
          <div className="shrink-0 px-5 py-2 border-t border-slate-100 bg-slate-50/50">
            <details className="group">
              <summary className="text-[11px] font-medium text-slate-400 cursor-pointer hover:text-slate-600 transition-colors list-none flex items-center gap-1.5">
                <svg className={`w-3 h-3 transition-transform group-open:rotate-90`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                {sources.length} source{sources.length > 1 ? "s" : ""}
              </summary>
              <div className="flex flex-wrap gap-2 mt-2">
                {sources.map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs text-slate-600 shadow-sm">
                    <span className="font-medium">{s.document_title || s.document_id?.slice(0, 8)}</span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-400">{(s.score * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            </details>
          </div>
        )}

        {/* input */}
        <div className="shrink-0 px-5 py-3 border-t border-slate-100">
          <div className="flex items-center gap-2 bg-slate-50 rounded-2xl border border-slate-200 focus-within:ring-2 focus-within:ring-indigo-400/30 focus-within:border-indigo-400 transition-all">
            <input ref={inputRef} value={question} onChange={e => setQuestion(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              className="flex-1 bg-transparent px-4 py-3 text-sm outline-none text-slate-700 placeholder:text-slate-400"
              placeholder="Ask a question about your documents..."
              disabled={loading} />
            <button onClick={send} disabled={loading || !question.trim()}
              className="mr-1.5 p-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:shadow-lg hover:shadow-indigo-500/30 active:scale-95">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
