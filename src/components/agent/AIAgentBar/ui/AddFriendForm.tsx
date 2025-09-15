import React, { useRef, useState } from 'react';

export type AddFriendFormProps = {
  onAdd: (nickname: string) => Promise<void> | void;
  disabled?: boolean;
};

export default function AddFriendForm({ onAdd, disabled }: AddFriendFormProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function submit() {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      await onAdd(v);
      setValue('');
      try { inputRef.current?.focus(); } catch {}
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e=> setValue(e.target.value)}
        placeholder={'nickname'}
        className="rounded-none text-black px-2 py-1 text-xs flex-1"
        disabled={disabled || busy}
      />
      <button
        className="text-xs px-2 py-1 border rounded-none disabled:opacity-50"
        onClick={()=> void submit()}
        disabled={disabled || busy || !value.trim()}
      >Add</button>
    </div>
  );
}


