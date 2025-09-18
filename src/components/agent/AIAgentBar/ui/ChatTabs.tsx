import { useState } from 'react';
import { Plus, History as HistoryIcon, X, Pencil } from 'lucide-react';

export type ChatTab = { _id: string; title: string; updatedAt?: number };

export type ChatTabsProps = {
  threads: ChatTab[];
  threadsLoading: boolean;
  threadsError: string | null;
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  showHistory: boolean;
  setShowHistory: (v: (prev: boolean) => boolean) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onDelete: (id: string) => Promise<void> | void;
  onRename: (id: string, title: string) => Promise<void> | void;
};

export default function ChatTabs(props: ChatTabsProps) {
  const { threads, threadsLoading, threadsError, activeThreadId, setActiveThreadId, showHistory, setShowHistory, onRefresh, onCreate, onDelete, onRename } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string>('');

  function beginEdit(id: string, title: string) {
    setEditingId(id);
    setEditingTitle(title || '');
  }

  async function commitEdit() {
    if (!editingId) return;
    const newTitle = editingTitle.trim() || 'Untitled';
    try { await onRename(editingId, newTitle); } finally { setEditingId(null); }
  }
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-8 w-8 inline-flex items-center justify-center rounded border border-white/15 text-white/80 hover:bg-white/10"
          title="History"
          onClick={() => { setShowHistory(v => !v); onRefresh(); }}
        >
          <HistoryIcon className="w-4 h-4" />
        </button>
        <div className="flex-1 overflow-x-auto">
          <div className="flex items-center gap-1 min-h-[32px]">
            {threadsLoading && (<div className="text-xs text-white/60 px-2">Loading…</div>)}
            {threadsError && (<div className="text-xs text-red-300 px-2">{threadsError}</div>)}
            {threads.map((t) => (
              <div key={t._id} className={`group flex items-center max-w-[260px] pl-3 pr-1 h-8 rounded-t bg-white/10 border border-white/20 border-b-0 ${activeThreadId === t._id ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/15'}`}>
                {editingId === t._id ? (
                  <input
                    autoFocus
                    className="flex-1 bg-transparent text-xs outline-none border-b border-white/40 focus:border-white px-0 mr-1"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void commitEdit(); }
                      if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
                    }}
                  />
                ) : (
                  <button className="flex-1 truncate text-xs text-left" onClick={() => setActiveThreadId(t._id)} title={t.title || 'Chat'}>
                    {t.title || 'Chat'}
                  </button>
                )}
                {editingId !== t._id && (
                  <button
                    className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded hover:bg-white/20"
                    title="Rename"
                    onClick={() => beginEdit(t._id, t.title)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded hover:bg-white/20"
                  title="Close"
                  onClick={() => onDelete(t._id)}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="h-8 w-8 inline-flex items-center justify-center rounded border border-white/15 text-white/80 hover:bg-white/10"
          title="New chat"
          onClick={onCreate}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      {activeThreadId && (
        <div className="mt-1 ml-10 text-[10px] text-white/60 flex items-center gap-2">
          <span className="opacity-80">ID:</span>
          <code className="font-mono bg-white/10 rounded px-1 py-[1px] text-[10px] select-all" title={activeThreadId}>{activeThreadId.slice(0, 10)}…</code>
          <button
            type="button"
            className="px-1 py-0.5 text-[10px] rounded border border-white/15 text-white/70 hover:bg-white/10"
            onClick={() => navigator.clipboard?.writeText(activeThreadId)}
            title="Copy ID"
          >
            Copy
          </button>
        </div>
      )}
      {showHistory && (
        <div className="mt-2 max-h-[220px] overflow-auto rounded border border-white/20 bg-white/10 p-2">
          {threads.map((t) => (
            <button key={t._id} onClick={() => { setActiveThreadId(t._id); setShowHistory(() => false); }} className={`w-full text-left text-xs rounded px-2 py-1 ${activeThreadId === t._id ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/15'}`}>
              <div className="truncate">{t.title || 'Chat'}</div>
              {t.updatedAt && (<div className="text-[10px] text-white/50">{new Date(t.updatedAt).toLocaleString()}</div>)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
