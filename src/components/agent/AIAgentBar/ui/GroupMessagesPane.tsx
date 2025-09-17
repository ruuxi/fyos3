import React from 'react';
import type { GroupMember, GroupMessage } from '../hooks/useGroupChats';

export type GroupMessagesPaneProps = {
  active: boolean;
  emptyLabel: string;
  messages: GroupMessage[];
  members: GroupMember[];
};

export default function GroupMessagesPane({ active, emptyLabel, messages, members }: GroupMessagesPaneProps) {
  const roster = members.map((m) => m.nickname || m.email || m.memberId.slice(0, 8));

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
      <div className="space-y-4 px-1">
        <div className="flex flex-wrap gap-2 text-xs text-white/70">
          {roster.length > 0 ? roster.map((label) => (
            <span key={label} className="px-2 py-1 bg-white/10 rounded-full border border-white/15">
              {label}
            </span>
          )) : (
            <span>No members yet</span>
          )}
        </div>
        {!active && (
          <div className="text-sm text-white/70">
            {emptyLabel}
          </div>
        )}
        {active && messages.length === 0 && (
          <div className="text-sm text-white/70">No messages yet. Start the conversation!</div>
        )}
        {active && messages.map((message) => {
          const key = message._id || message.id || `${message.createdAt}-${Math.random()}`;
          const senderLabel = message.senderNickname || message.senderEmail || message.senderId.slice(0, 8) || 'Member';
          const isMine = false; // styling neutral timeline (all align left)
          return (
            <div key={key} className={`text-sm flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-full flex-1">
                <div className="text-xs mb-1 text-white/60 pl-1">
                  {senderLabel}
                </div>
                <div className="inline-block max-w-[80%] rounded-2xl px-3 py-2 whitespace-pre-wrap break-words bg-white/10 border border-white/15 text-white">
                  {message.content}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

