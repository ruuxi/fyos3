import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Paperclip, Send, X, FileAudio2, FileText, File as FileIcon, RotateCcw, Square } from 'lucide-react';

export type Attachment = { name: string; publicUrl: string; contentType: string };

export type ChatComposerProps = {
  input: string;
  setInput: (v: string) => void;
  status: string;
  attachments: Attachment[];
  removeAttachment: (index: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onFileSelect: (files: FileList) => void;
  onStop: () => void;
  onFocus?: () => void;
  uploadBusy?: boolean;
  canUndo?: boolean;
  onUndo?: () => void;
  placeholderWord?: string;
  showAnimatedPlaceholder?: boolean;
  placeholderTheme?: 'blue' | 'red' | 'orange' | 'green';
  magicWord?: string;
};

export default function ChatComposer(props: ChatComposerProps) {
  const { input, setInput, status, attachments, removeAttachment, onSubmit, onFileSelect, onStop, onFocus, uploadBusy, canUndo, onUndo, placeholderWord, showAnimatedPlaceholder, placeholderTheme, magicWord } = props;
  return (
    <form onSubmit={onSubmit}>
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-16">
              {attachments.map((a, index) => {
                const ct = (a.contentType || '').toLowerCase();
                const isImage = ct.startsWith('image/');
                const isVideo = ct.startsWith('video/');
                const isAudio = ct.startsWith('audio/');
                const isText = ct.startsWith('text/') || /(\.txt|\.md|\.json|\.csv|\.log)$/i.test(a.name);
                return (
                  <div key={index} className="relative w-28 h-20 rounded border border-white/20 overflow-hidden bg-white/10">
                    {isImage && a.publicUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.publicUrl} alt={a.name} className="w-full h-full object-cover" />
                    ) : isVideo && a.publicUrl ? (
                      <video src={a.publicUrl} className="w-full h-full object-cover" muted playsInline />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white/90">
                        {isAudio ? (
                          <FileAudio2 className="w-6 h-6" />
                        ) : isText ? (
                          <FileText className="w-6 h-6" />
                        ) : (
                          <FileIcon className="w-6 h-6" />
                        )}
                      </div>
                    )}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 text-[10px] px-1 py-0.5 truncate" title={a.name}>
                      {a.name}
                    </div>
                    <button
                      onClick={() => removeAttachment(index)}
                      className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 rounded p-0.5 text-white"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <Textarea
            value={input}
            onFocus={onFocus}
            onChange={e => setInput(e.target.value)}
            placeholder="'Create a Notes app, Change my background!'"
            className="pl-24 pr-12 h-10 min-h-0 py-2 resize-none rounded-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none text-white placeholder:text-white/60 caret-sky-300 text-base leading-6"
            rows={1}
            disabled={false}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && status === 'ready' && !uploadBusy) onSubmit(e as any);
              }
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          {(status === 'submitted' || status === 'streaming') && (
            <div className="flex items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 rounded-none text-white hover:bg-white/10 flex items-center gap-2 relative"
                onClick={onStop}
                title="Stop"
                aria-label="Stop"
                style={{
                  ['--bg-glow' as any]: placeholderTheme === 'red' ? 'rgba(244,63,94,0.15)'
                    : placeholderTheme === 'orange' ? 'rgba(251,146,60,0.15)'
                    : placeholderTheme === 'green' ? 'rgba(34,197,94,0.15)'
                    : 'rgba(59,130,246,0.15)'
                } as any}
              >
                {/* Background glow */}
                <div className="absolute inset-0 rounded bg-glow opacity-80 animate-pulse" />
                <span
                  className="magic-stop text-base leading-6 select-none relative z-10"
                  style={{
                    ['--magic-c1' as any]: placeholderTheme === 'red' ? 'rgba(244,63,94,0.9)'
                      : placeholderTheme === 'orange' ? 'rgba(251,146,60,0.9)'
                      : placeholderTheme === 'green' ? 'rgba(34,197,94,0.9)'
                      : 'rgba(59,130,246,0.9)',
                    ['--magic-c2' as any]: placeholderTheme === 'red' ? 'rgba(244,63,94,1)'
                      : placeholderTheme === 'orange' ? 'rgba(251,146,60,1)'
                      : placeholderTheme === 'green' ? 'rgba(34,197,94,1)'
                      : 'rgba(59,130,246,1)',
                    ['--magic-c3' as any]: placeholderTheme === 'red' ? 'rgba(244,63,94,0.9)'
                      : placeholderTheme === 'orange' ? 'rgba(251,146,60,0.9)'
                      : placeholderTheme === 'green' ? 'rgba(34,197,94,0.9)'
                      : 'rgba(59,130,246,0.9)'
                  } as any}
                >
                  {(magicWord || 'Working').split('').map((ch, i) => (
                    <span key={i} className="magic-stop-letter" style={{ ['--d' as any]: `${i * 55}ms` as any }}>{ch}</span>
                  ))}
                </span>
                <Square className="w-4 h-4 relative z-10" />
              </Button>
              <style jsx>{`
                .magic-stop { color: transparent; position: relative; }
                .magic-stop .magic-stop-letter {
                  background-image: linear-gradient(90deg, var(--magic-c1) 0%, var(--magic-c2) 50%, var(--magic-c3) 100%);
                  -webkit-background-clip: text;
                  background-clip: text;
                  filter: drop-shadow(0 0 1rem rgba(255,255,255,0.7)) brightness(1.8) saturate(1.3);
                  background-size: 220% 100%;
                  animation: gloss 1400ms cubic-bezier(0.22, 1, 0.36, 1) infinite, float 2600ms ease-in-out infinite;
                  animation-delay: var(--d), calc(var(--d) * 0.35);
                  display: inline-block;
                }
                .bg-glow {
                  background: var(--bg-glow);
                  box-shadow: 0 0 20px var(--bg-glow), inset 0 0 10px var(--bg-glow);
                }
                @keyframes gloss { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
                @keyframes float { 0%, 100% { transform: translateY(0); opacity: 0.95 } 50% { transform: translateY(-1px); opacity: 1 } }
              `}</style>
            </div>
          )}
          <div className="relative">
            <input
              type="file"
              accept="image/*,video/*,audio/*,.txt,.md,.json,.csv"
              multiple
              onChange={(e) => { if (e.target.files) { onFileSelect(e.target.files); e.target.value = ''; } }}
              className="absolute inset-0 opacity-0 cursor-pointer"
              id="file-upload"
            />
            <Button type="button" variant="ghost" size="sm" className="h-10 rounded-none text-white hover:bg-white/10" asChild>
              <label htmlFor="file-upload" className="cursor-pointer">
                <Paperclip className="w-4 h-4" />
              </label>
            </Button>
          </div>
          {canUndo && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-10 rounded-none text-white hover:bg-white/10"
              onClick={onUndo}
              disabled={status !== 'ready'}
              aria-label="Undo last agent changes"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
          <Button type="submit" disabled={!input.trim() || status !== 'ready' || !!uploadBusy} size="sm" variant="ghost" className="h-10 rounded-none text-white hover:bg-white/10">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}


