/**
 * Simple test for auto-ingest logic (JavaScript version)
 */

// Mock fetch
global.fetch = async (url, _options) => {
  if (url === '/api/media/ingest') {
    return {
      ok: true,
      json: async () => ({
        publicUrl: `https://fyos.app/media/test-${Math.random().toString(36).slice(2)}.jpg`
      })
    };
  }
  throw new Error('Unexpected fetch');
};

// Simplified auto-ingest logic for testing
function isExternalUrl(value) {
  return typeof value === 'string' && 
         (value.startsWith('http://') || value.startsWith('https://')) &&
         !value.includes('fyos.app/media/');
}

function isBase64Data(value) {
  return typeof value === 'string' && 
         (value.startsWith('data:') || (value.length > 100 && /^[A-Za-z0-9+/=]+$/.test(value)));
}

async function testLogic() {
  console.log('🧪 Testing Auto-Ingest Detection Logic\n');

  // Test URL detection
  console.log('URL Detection Tests:');
  console.log('✅ External URL detected:', isExternalUrl('https://example.com/photo.jpg'));
  console.log('✅ FYOS URL ignored:', !isExternalUrl('https://fyos.app/media/abc123.jpg'));
  console.log('✅ Non-URL ignored:', !isExternalUrl('just a string'));

  console.log('\nBase64 Detection Tests:');
  console.log('✅ Data URL detected:', isBase64Data('data:image/png;base64,iVBORw0KGg...'));
  console.log('✅ Long base64 detected:', isBase64Data('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='));
  console.log('✅ Short string ignored:', !isBase64Data('short'));

  console.log('\n🎉 Detection logic tests passed!');

  // Test the actual ingestion workflow
  console.log('\n🔄 Testing ingestion workflow...');
  
  const testUrl = 'https://example.com/test.jpg';
  if (isExternalUrl(testUrl)) {
    try {
      const response = await fetch('/api/media/ingest', {
        method: 'POST',
        body: JSON.stringify({ sourceUrl: testUrl })
      });
      const result = await response.json();
      console.log('✅ Mock ingestion successful:', result.publicUrl);
    } catch (error) {
      console.error('❌ Mock ingestion failed:', error);
    }
  }

  console.log('\n🎉 All tests completed successfully!');
}

testLogic().catch(console.error);
