import React from 'react';

export type FriendMessagesPaneProps = {
  messages: Array<{ _id?: string; id?: string; ownerId: string; peerId: string; senderId: string; content: string; createdAt: number }>;
  activePeerId: string | null;
};

export default function FriendMessagesPane({ messages, activePeerId }: FriendMessagesPaneProps) {
  return (
    <div
      className="overflow-auto pt-2 pb-2 modern-scrollbar pr-2 pl-2"
      style={{
        maxHeight: '60vh',
        transition: 'height 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: 'height',
        scrollBehavior: 'auto',
        paddingLeft: '12px',
        paddingRight: '12px',
      }}
    >
      <div className="space-y-3 px-1">
        {!activePeerId && (
          <div className="text-sm text-white/70">Select a friend to start chatting.</div>
        )}
        {activePeerId && messages.length === 0 && (
          <div className="text-sm text-white/70">No messages yet. Say hi!</div>
        )}
        {messages.map((m) => {
          const key = m._id || m.id || `${m.createdAt}-${Math.random()}`;
          const isMine = m.senderId !== activePeerId; // in sender's copy, senderId is me; in recipient's, ownerId changes, but this heuristic works for local view
          return (
            <div key={key} className={`text-sm flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`${isMine ? 'flex flex-col items-end max-w-[80%]' : 'max-w-full flex-1'}`}>
                <div className={`text-xs mb-1 ${isMine ? 'text-white/60 pr-1' : 'text-white/60 pl-1'}`}>
                  {isMine ? 'You' : 'Friend'}
                </div>
                <div className={`rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${isMine ? 'bg-sky-500 text-white max-w-full' : 'inline-block max-w-[80%] bg-white/10 border border-white/15 text-white'}`}>
                  {m.content}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


