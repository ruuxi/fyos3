'use client';

import { useState } from 'react';
import { useWebContainer } from './WebContainerProvider';

export default function ExtractLockfileButton() {
  const { instance } = useWebContainer();
  const [isExtracting, setIsExtracting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const extractLockfile = async () => {
    if (!instance) {
      setError('WebContainer not ready');
      return;
    }

    setIsExtracting(true);
    setMessage(null);
    setError(null);

    try {
      // Check if pnpm-lock.yaml exists
      let lockfileContent: string | null = null;
      try {
        const lockfileBuffer = await instance.fs.readFile('pnpm-lock.yaml');
        lockfileContent = new TextDecoder().decode(lockfileBuffer);
      } catch {
        setError('pnpm-lock.yaml not found in WebContainer. Try installing dependencies first.');
        return;
      }

      // Send to API to save
      const response = await fetch('/api/extract-lockfile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ lockfileContent }),
      });

      const result = await response.json();

      if (result.success) {
        setMessage(result.message);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-card">
      <h3 className="text-lg font-semibold mb-2 text-foreground">Extract Lockfile</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Extract pnpm-lock.yaml from WebContainer and save to templates/webcontainer/
      </p>
      
      <button
        onClick={extractLockfile}
        disabled={!instance || isExtracting}
        className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
      >
        {isExtracting ? 'Extracting...' : 'Extract Lockfile'}
      </button>

      {message && (
        <div className="mt-3 p-3 bg-muted/30 border border-border text-foreground rounded">
          ✅ {message}
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-destructive/20 border border-destructive text-destructive rounded">
          ❌ {error}
        </div>
      )}
    </div>
  );
}
