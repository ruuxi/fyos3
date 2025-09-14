import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Paperclip, Send, X, FileAudio2, FileText, File as FileIcon } from 'lucide-react';

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
};

export default function ChatComposer(props: ChatComposerProps) {
  const { input, setInput, status, attachments, removeAttachment, onSubmit, onFileSelect, onStop, onFocus, uploadBusy } = props;
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
            placeholder="Ask the AI agent… Try: 'Create a Notes app, Change my background!'"
            className="pl-24 pr-12 h-10 min-h-0 py-2 resize-none rounded-none bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 outline-none text-white placeholder:text-white/60 caret-sky-300 text-base leading-6"
            rows={1}
            disabled={status === 'submitted' || status === 'streaming'}
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
            <Button type="button" variant="ghost" size="sm" className="h-10 rounded-none" onClick={onStop}>
              Stop
            </Button>
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
          <Button type="submit" disabled={!input.trim() || status !== 'ready' || !!uploadBusy} size="sm" className="h-10 rounded-none text-white hover:bg-white/10">
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}


