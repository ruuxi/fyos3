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

};

export default function ChatComposer(props: ChatComposerProps) {
  const { input, setInput, status, attachments, removeAttachment, onSubmit, onFileSelect, onStop, onFocus, uploadBusy, canUndo, onUndo } = props;
  return (
    <form onSubmit={onSubmit}>
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-2">
          {attachments.map((a, index) => {
            const ct = (a.contentType || '').toLowerCase();
            const isImage = ct.startsWith('image/');
            const isVideo = ct.startsWith('video/');
            const isAudio = ct.startsWith('audio/');
            const isText = ct.startsWith('text/') || /(\.txt|\.md|\.json|\.csv|\.log)$/i.test(a.name);
            return (
              <div key={index} className="relative h-20 w-28 overflow-hidden rounded-lg border border-white/20 bg-white/10">
                {isImage && a.publicUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.publicUrl} alt={a.name} className="h-full w-full object-cover" />
                ) : isVideo && a.publicUrl ? (
                  <video src={a.publicUrl} className="h-full w-full object-cover" muted playsInline />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/90">
                    {isAudio ? (
                      <FileAudio2 className="h-6 w-6" />
                    ) : isText ? (
                      <FileText className="h-6 w-6" />
                    ) : (
                      <FileIcon className="h-6 w-6" />
                    )}
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-0.5 text-[10px]" title={a.name}>
                  {a.name}
                </div>
                <button
                  onClick={() => removeAttachment(index)}
                  className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white hover:bg-black/80"
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="relative rounded-xl bg-white/10">
        <Textarea
          value={input}
          onFocus={onFocus}
          onChange={e => setInput(e.target.value)}
          placeholder="Change my background."
          className="h-12 min-h-0 w-full resize-none border-0 bg-transparent py-3 pl-4 pr-28 font-medium text-white placeholder:text-white/60 caret-sky-300 focus-visible:ring-0 focus-visible:ring-offset-0"
          rows={1}
          disabled={false}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() && status === 'ready' && !uploadBusy) {
                e.currentTarget.form?.requestSubmit();
              }
            }
          }}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-2">
          {(status === 'submitted' || status === 'streaming') && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-white hover:bg-white/10"
              onClick={onStop}
              title="Stop"
              aria-label="Stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          )}
          {canUndo && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-white hover:bg-white/10"
              onClick={onUndo}
              disabled={status !== 'ready'}
              aria-label="Undo last agent changes"
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          )}
          <div className="relative">
            <input
              type="file"
              accept="image/*,video/*,audio/*,.txt,.md,.json,.csv"
              multiple
              onChange={(e) => { if (e.target.files) { onFileSelect(e.target.files); e.target.value = ''; } }}
              className="absolute inset-0 cursor-pointer opacity-0"
              id="file-upload"
            />
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full text-white hover:bg-white/10" asChild>
              <label htmlFor="file-upload" className="cursor-pointer">
                <Paperclip className="h-4 w-4" />
              </label>
            </Button>
          </div>
          <Button
            type="submit"
            disabled={!input.trim() || status !== 'ready' || !!uploadBusy}
            size="icon"
            variant="ghost"
            className="h-9 w-9 rounded-full text-white hover:bg-white/10"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </form>
  );
}
