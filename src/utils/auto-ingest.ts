/**
 * Auto-ingest utility for processing AI tool inputs
 * Automatically detects and ingests external URLs and base64 data
 */

type MediaScope = { desktopId?: string; appId?: string; appName?: string };

/**
 * Detects if a string is an external HTTP/HTTPS URL that needs ingesting
 */
function isExternalUrl(value: string): boolean {
  if (typeof value !== 'string') return false;
  
  // Check if it's an HTTP/HTTPS URL
  if (!value.startsWith('http://') && !value.startsWith('https://')) return false;
  
  // Skip URLs that are already FYOS URLs (no need to ingest)
  if (value.includes('fyos.app/media/') || value.includes('/api/media/')) return false;
  
  return true;
}

/**
 * Detects if a string is base64 data (data URL or raw base64)
 */
function isBase64Data(value: string): boolean {
  if (typeof value !== 'string') return false;
  
  // Data URL format
  if (value.startsWith('data:')) return true;
  
  // Raw base64 (heuristic: long string with base64 chars, likely > 100 chars)
  if (value.length > 100 && /^[A-Za-z0-9+/=]+$/.test(value)) return true;
  
  return false;
}

/**
 * Extracts content type and base64 data from a data URL or raw base64
 */
function parseBase64(value: string): { base64: string; contentType?: string } {
  if (value.startsWith('data:')) {
    // Data URL format: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...
    const match = value.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { base64: match[2], contentType: match[1] };
    }
  }
  
  // Assume raw base64
  return { base64: value };
}

/**
 * Ingests a URL or base64 data and returns the public URL
 */
async function ingestMedia(
  data: { sourceUrl?: string; base64?: string; contentType?: string },
  scope?: MediaScope
): Promise<string | null> {
  try {
    const response = await fetch('/api/media/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, scope }),
    });
    
    if (!response.ok) {
      console.warn('Media ingest failed:', response.status, response.statusText);
      return null;
    }
    
    const result = await response.json();
    return result.publicUrl || null;
  } catch (error) {
    console.warn('Media ingest error:', error);
    return null;
  }
}

/**
 * Recursively processes an object to find and ingest media URLs/base64 data
 */
export async function autoIngestInputs<T>(
  input: T,
  scope?: MediaScope
): Promise<{ processedInput: T; ingestedCount: number }> {
  let ingestedCount = 0;
  
  async function processValue(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      // Handle external URLs
      if (isExternalUrl(value)) {
        console.log('🔄 Auto-ingesting external URL:', value.substring(0, 60) + '...');
        const publicUrl = await ingestMedia({ sourceUrl: value }, scope);
        if (publicUrl) {
          ingestedCount++;
          return publicUrl;
        }
        console.warn('⚠️ Failed to ingest URL, using original:', value);
        return value;
      }
      
      // Handle base64 data
      if (isBase64Data(value)) {
        console.log('🔄 Auto-ingesting base64 data:', value.substring(0, 40) + '...');
        const { base64, contentType } = parseBase64(value);
        const publicUrl = await ingestMedia({ base64, contentType }, scope);
        if (publicUrl) {
          ingestedCount++;
          return publicUrl;
        }
        console.warn('⚠️ Failed to ingest base64 data, using original');
        return value;
      }
      
      return value;
    }
    
    if (Array.isArray(value)) {
      return Promise.all(value.map(processValue));
    }
    
    if (value && typeof value === 'object') {
      const processed: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        processed[key] = await processValue(val);
      }
      return processed;
    }
    
    return value;
  }
  
  const processedInput = await processValue(input);
  
  if (ingestedCount > 0) {
    console.log(`✅ Auto-ingested ${ingestedCount} media item(s)`);
  }
  
  return { processedInput: processedInput as T, ingestedCount };
}
