import React from 'react';
import type { GroupMember, GroupMessage } from '../hooks/useGroupChats';

export type GroupMessagesPaneProps = {
  active: boolean;
  emptyLabel: string;
  messages: GroupMessage[];
  members: GroupMember[];
  currentUserId?: string;
};

export default function GroupMessagesPane({ active, emptyLabel, messages, members, currentUserId }: GroupMessagesPaneProps) {
  const roster = members.map((m) => m.nickname || m.email || m.memberId.slice(0, 8));

  return (
    <div
      className="modern-scrollbar overflow-auto px-3 py-2"
      style={{
        height: '100%',
        transition: 'height 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        willChange: 'height',
        scrollBehavior: 'auto',
      }}
    >
      <div className="space-y-4 px-1">
        <div className="flex flex-wrap gap-2 text-xs text-white/70">
          {roster.length > 0 ? roster.map((label) => (
            <span key={label} className="rounded-full border border-white/15 bg-white/10 px-2 py-1">
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
          const isMine = currentUserId ? message.senderId === currentUserId : false;
          return (
            <div key={key} className={`text-sm flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div className={`${isMine ? 'flex flex-col items-end max-w-[80%]' : 'max-w-full flex-1'}`}>
                <div className={`text-xs mb-1 ${isMine ? 'text-white/60 pr-1' : 'text-white/60 pl-1'}`}>
                  {senderLabel}
                </div>
                <div className={`rounded-2xl px-3 py-2 whitespace-pre-wrap break-words ${isMine ? 'bg-sky-500 text-white max-w-full' : 'inline-block max-w-[80%] bg-white/10 border border-white/15 text-white'}`}>
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
