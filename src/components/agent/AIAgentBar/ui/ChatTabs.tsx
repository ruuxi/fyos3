import { Plus, History as HistoryIcon, X } from 'lucide-react';

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
};

export default function ChatTabs(props: ChatTabsProps) {
  const { threads, threadsLoading, threadsError, activeThreadId, setActiveThreadId, showHistory, setShowHistory, onRefresh, onCreate, onDelete } = props;
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
              <div key={t._id} className={`group flex items-center max-w-[220px] pl-3 pr-1 h-8 rounded-t bg-white/10 border border-white/20 border-b-0 ${activeThreadId === t._id ? 'bg-white/20 text-white' : 'text-white/80 hover:bg-white/15'}`}>
                <button className="flex-1 truncate text-xs text-left" onClick={() => setActiveThreadId(t._id)} title={t.title || 'Chat'}>
                  {t.title || 'Chat'}
                </button>
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


