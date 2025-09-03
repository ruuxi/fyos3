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
    <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
      <h3 className="text-lg font-semibold mb-2">Extract Lockfile</h3>
      <p className="text-sm text-gray-600 mb-4">
        Extract pnpm-lock.yaml from WebContainer and save to templates/webcontainer/
      </p>
      
      <button
        onClick={extractLockfile}
        disabled={!instance || isExtracting}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        {isExtracting ? 'Extracting...' : 'Extract Lockfile'}
      </button>

      {message && (
        <div className="mt-3 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          ✅ {message}
        </div>
      )}

      {error && (
        <div className="mt-3 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          ❌ {error}
        </div>
      )}
    </div>
  );
}
