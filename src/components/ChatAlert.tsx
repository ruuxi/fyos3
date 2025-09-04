'use client';

import React from 'react';

type Props = {
  alert: {
    source: 'preview' | 'terminal';
    title: string;
    description?: string;
    content: string;
  };
  onAsk: (message: string) => void;
  onDismiss: () => void;
};

export default function ChatAlert({ alert, onAsk, onDismiss }: Props) {
  const { description, content, source, title } = alert;
  const isPreview = source === 'preview';
  const header = isPreview ? 'Preview Error' : 'Terminal Error';
  const prompt = isPreview
    ? 'We encountered an error while running the preview. Ask the AI to analyze and fix it?'
    : 'We encountered an error while running terminal commands. Ask the AI to analyze and fix it?';

  return (
    <div className="rounded-md border p-3 border-red-200 bg-red-50 text-red-900">
      <div className="flex items-start gap-2">
        <div className="shrink-0">⚠️</div>
        <div className="flex-1">
          <div className="font-medium text-sm">{header}</div>
          <div className="text-xs mt-1">{prompt}</div>
          <div className="text-xs mt-2">
            <div className="font-medium">{title}</div>
            {description && (
              <div className="mt-1 text-[11px] text-red-800">Error: {description}</div>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="px-2 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700"
              onClick={() => onAsk(`*Fix this ${isPreview ? 'preview' : 'terminal'} error* \n\`\`\`${isPreview ? 'js' : 'sh'}\n${content}\n\`\`\`\n`)}
            >
              Ask AI
            </button>
            <button
              className="px-2 py-1 rounded bg-white text-red-700 border text-xs hover:bg-red-100"
              onClick={onDismiss}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

