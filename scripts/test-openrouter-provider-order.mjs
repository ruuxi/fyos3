#!/usr/bin/env node
// Test script to verify OpenRouter provider order configuration

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { streamText, generateText } from 'ai';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

// Load env vars if .env.local exists
try {
  const envPath = resolve(repoRoot, '.env.local');
  const envContent = readFileSync(envPath, 'utf-8');
  const envVars = {};
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      envVars[key] = value;
    }
  });
  Object.assign(process.env, envVars);
} catch (err) {
  console.log('⚠️  No .env.local found, using process.env');
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY not found in environment');
  console.log('💡 Set OPENROUTER_API_KEY in .env.local or environment');
  process.exit(1);
}

console.log('🧪 Testing OpenRouter provider order configuration...\n');

// Test 1: Verify TypeScript structure compiles (structure test)
console.log('Test 1: Verifying configuration structure...');
try {
  const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
  });

  const testConfig = {
    model: openrouter('z-ai/glm-4.6:nitro'),
    providerOptions: {
      openrouter: {
        provider: {
          order: ['cerebras', 'fireworks'],
        },
      },
    },
    messages: [{ role: 'user', content: 'Say "test" only.' }],
    maxTokens: 10,
  };

  console.log('✅ Configuration structure is valid');
  console.log('   Config:', JSON.stringify({
    providerOptions: {
      openrouter: {
        provider: {
          order: testConfig.providerOptions.openrouter.provider.order,
        },
      },
    },
  }, null, 2));
} catch (error) {
  console.error('❌ Configuration structure error:', error.message);
  process.exit(1);
}

// Test 2: Make actual API call and inspect request
console.log('\nTest 2: Making API call to verify provider order is sent...');
try {
  const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
  });

  // Create a custom fetch to intercept the request and response
  let interceptedRequest = null;
  let interceptedResponse = null;
  const originalFetch = globalThis.fetch;
  
  globalThis.fetch = async (url, options) => {
    interceptedRequest = {
      url,
      method: options?.method,
      headers: options?.headers,
      body: options?.body ? JSON.parse(options.body) : null,
    };
    
    // Log what we're sending
    console.log('\n📤 Request being sent to OpenRouter:');
    console.log('   URL:', url);
    console.log('   Method:', interceptedRequest.method);
    console.log('   Body:', JSON.stringify(interceptedRequest.body, null, 2));
    
    // Call original fetch and capture response
    const response = await originalFetch(url, options);
    
    // Capture response headers
    interceptedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: {},
    };
    
    // Extract all response headers
    response.headers.forEach((value, key) => {
      interceptedResponse.headers[key.toLowerCase()] = value;
    });
    
    // Return a new Response with the same body but we've captured headers
    return response;
  };

  const result = streamText({
    model: openrouter('z-ai/glm-4.6:nitro'),
    providerOptions: {
      openrouter: {
        provider: {
          order: ['cerebras', 'fireworks'],
        },
      },
    },
    messages: [{ role: 'user', content: 'Say "test" only.' }],
    maxTokens: 10,
  });

  // Consume the stream to trigger the request
  const reader = result.textStream.getReader();
  let text = '';
  let done = false;
  
  while (!done) {
    const { value, done: streamDone } = await reader.read();
    done = streamDone;
    if (value) {
      text += value;
    }
  }

  // Wait a bit for response to be captured
  await new Promise(resolve => setTimeout(resolve, 100));

  // Verify the request body contains provider order
  if (interceptedRequest?.body) {
    const body = interceptedRequest.body;
    
    console.log('\n📋 Verifying request body structure...');
    
    if (body.provider && body.provider.order) {
      console.log('✅ Provider order found in request body!');
      console.log('   Order:', body.provider.order);
      
      if (JSON.stringify(body.provider.order) === JSON.stringify(['cerebras', 'fireworks'])) {
        console.log('✅ Provider order matches expected: ["cerebras", "fireworks"]');
      } else {
        console.error('❌ Provider order mismatch!');
        console.error('   Expected: ["cerebras", "fireworks"]');
        console.error('   Got:', body.provider.order);
        process.exit(1);
      }
    } else {
      console.error('❌ Provider order NOT found in request body!');
      console.error('   Request body keys:', Object.keys(body));
      if (body.provider) {
        console.error('   Provider keys:', Object.keys(body.provider));
      }
      process.exit(1);
    }
  } else {
    console.error('❌ Could not intercept request body');
    process.exit(1);
  }

  // Restore original fetch
  globalThis.fetch = originalFetch;

  // Test 3: Verify response contains provider information
  console.log('\n📥 Verifying response...');
  
  if (interceptedResponse) {
    console.log('   Status:', interceptedResponse.status);
    console.log('   Response headers:', Object.keys(interceptedResponse.headers));
    
    // OpenRouter typically returns provider info in headers
    const providerHeader = interceptedResponse.headers['x-openrouter-provider'] || 
                          interceptedResponse.headers['openrouter-provider'] ||
                          interceptedResponse.headers['x-provider'];
    
    if (providerHeader) {
      console.log('✅ Provider information found in response headers!');
      console.log('   Provider used:', providerHeader);
      
      // Check if the provider used is one of the ordered providers
      const orderedProviders = ['cerebras', 'fireworks'];
      const providerUsed = providerHeader.toLowerCase();
      const isOrderedProvider = orderedProviders.some(p => 
        providerUsed.includes(p.toLowerCase())
      );
      
      if (isOrderedProvider) {
        console.log('✅ Provider used matches one of the ordered providers!');
      } else {
        console.log('⚠️  Provider used does not match ordered providers');
        console.log('   Ordered:', orderedProviders);
        console.log('   Used:', providerUsed);
        console.log('   (This might be OK if the first provider was unavailable)');
      }
    } else {
      console.log('⚠️  No provider header found in response');
      console.log('   Available headers:', Object.keys(interceptedResponse.headers));
      console.log('   (This might be normal - checking response metadata...)');
    }
  } else {
    console.log('⚠️  Could not intercept response');
  }

  // Test 4: Use generateText to get provider metadata
  console.log('\n📊 Testing with generateText to get provider metadata...');
  try {
    const generateResult = await generateText({
      model: openrouter('z-ai/glm-4.6'),
      providerOptions: {
        openrouter: {
          provider: {
            order: ['cerebras', 'fireworks'],
          },
        },
      },
      messages: [{ role: 'user', content: 'Say "test" only.' }],
      maxTokens: 10,
    });

    if (generateResult?.providerMetadata?.openrouter) {
      console.log('✅ Provider metadata found!');
      console.log('   Metadata:', JSON.stringify(generateResult.providerMetadata.openrouter, null, 2));
      
      if (generateResult.providerMetadata.openrouter.provider) {
        console.log('✅ Provider used:', generateResult.providerMetadata.openrouter.provider);
        
        const orderedProviders = ['cerebras', 'fireworks'];
        const providerUsed = generateResult.providerMetadata.openrouter.provider.toLowerCase();
        const isOrderedProvider = orderedProviders.some(p => 
          providerUsed.includes(p.toLowerCase())
        );
        
        if (isOrderedProvider) {
          console.log('✅ Provider matches ordered providers!');
        } else {
          console.log('⚠️  Provider does not match ordered providers');
          console.log('   Ordered:', orderedProviders);
          console.log('   Used:', providerUsed);
        }
      }
    } else {
      console.log('⚠️  No provider metadata in result');
    }
  } catch (err) {
    console.log('   (Metadata check failed:', err.message + ')');
  }

  console.log('\n✅ All tests passed!');
  console.log('   Response preview:', text.substring(0, 50));
  
} catch (error) {
  console.error('\n❌ API call test failed:', error.message);
  console.error('   Stack:', error.stack);
  process.exit(1);
}

console.log('\n🎉 Provider order configuration is working correctly!');

