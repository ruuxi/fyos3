export function formatBytes(n?: number): string {
  if (!n || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = n;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function guessContentTypeFromFilename(name: string): string {
  const lower = (name || '').toLowerCase();
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(lower)) return 'image/*';
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(lower)) return 'video/*';
  if (/\.(mp3|wav|m4a|aac|flac|ogg)$/.test(lower)) return 'audio/*';
  if (/\.(txt|md|json|csv|log)$/.test(lower)) return 'text/plain';
  return 'application/octet-stream';
}

export function JSONSafe(output: string): string {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    return output.slice(start, end + 1);
  }
  return '[]';
}

export function stableHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

export function trimForChat(s: string): string {
  const maxChars = 8000;
  return s.length > maxChars ? `${s.slice(0, 4000)}\n...\n${s.slice(-3500)}` : s;
}


