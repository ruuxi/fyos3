/**
 * Simple test script for auto-ingest functionality
 * This tests the logic without making actual API calls
 */

// Mock the fetch function to simulate API responses
global.fetch = async (url, options) => {
  if (url === '/api/media/ingest') {
    const body = JSON.parse(options.body);
    // Simulate successful ingest response
    return {
      ok: true,
      json: async () => ({
        publicUrl: `https://fyos.app/media/ingested-${Math.random().toString(36).slice(2)}.jpg`,
        contentType: body.contentType || 'image/jpeg',
        size: 123456
      })
    };
  }
  throw new Error('Unexpected fetch call');
};

// Import our auto-ingest function
const { autoIngestInputs } = require('./src/utils/auto-ingest.ts');

async function testAutoIngest() {
  console.log('🧪 Testing Auto-Ingest Logic\n');

  // Test 1: External URL detection and ingestion
  console.log('Test 1: External URL ingestion');
  const input1 = {
    prompt: 'Make this image into a video',
    image_url: 'https://example.com/photo.jpg'
  };
  
  try {
    const result1 = await autoIngestInputs(input1);
    console.log('✅ Input:', JSON.stringify(input1, null, 2));
    console.log('✅ Output:', JSON.stringify(result1.processedInput, null, 2));
    console.log('✅ Ingested count:', result1.ingestedCount);
    console.log('✅ URL was processed:', result1.processedInput.image_url.includes('fyos.app'));
  } catch (error) {
    console.error('❌ Test 1 failed:', error);
  }

  console.log('\n---\n');

  // Test 2: Base64 data URL detection
  console.log('Test 2: Base64 data URL ingestion');
  const input2 = {
    prompt: 'Generate from this image',
    init_image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
  };
  
  try {
    const result2 = await autoIngestInputs(input2);
    console.log('✅ Input had data URL');
    console.log('✅ Output URL:', result2.processedInput.init_image);
    console.log('✅ Ingested count:', result2.ingestedCount);
    console.log('✅ Data URL was processed:', result2.processedInput.init_image.includes('fyos.app'));
  } catch (error) {
    console.error('❌ Test 2 failed:', error);
  }

  console.log('\n---\n');

  // Test 3: No ingestion needed (already FYOS URL)
  console.log('Test 3: FYOS URL (should not be ingested)');
  const input3 = {
    prompt: 'Process this image',
    image_url: 'https://fyos.app/media/existing-123.jpg'
  };
  
  try {
    const result3 = await autoIngestInputs(input3);
    console.log('✅ Input:', JSON.stringify(input3, null, 2));
    console.log('✅ Output:', JSON.stringify(result3.processedInput, null, 2));
    console.log('✅ Ingested count:', result3.ingestedCount);
    console.log('✅ URL unchanged:', result3.processedInput.image_url === input3.image_url);
  } catch (error) {
    console.error('❌ Test 3 failed:', error);
  }

  console.log('\n---\n');

  // Test 4: Nested object processing
  console.log('Test 4: Nested object with multiple URLs');
  const input4 = {
    model_params: {
      style_image: 'https://example.com/style.jpg',
      content_image: 'https://example.com/content.jpg'
    },
    prompt: 'Mix these images'
  };
  
  try {
    const result4 = await autoIngestInputs(input4);
    console.log('✅ Processed nested object');
    console.log('✅ Style URL processed:', result4.processedInput.model_params.style_image.includes('fyos.app'));
    console.log('✅ Content URL processed:', result4.processedInput.model_params.content_image.includes('fyos.app'));
    console.log('✅ Ingested count:', result4.ingestedCount);
  } catch (error) {
    console.error('❌ Test 4 failed:', error);
  }

  console.log('\n🎉 Auto-ingest tests completed!');
}

// Run the tests
testAutoIngest().catch(console.error);
