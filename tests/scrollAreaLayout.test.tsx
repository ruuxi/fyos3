import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ScrollArea } from '@/components/ui/scroll-area';

const extractElementBySlot = (markup: string, slot: string) => {
  const pattern = new RegExp(`<[^>]+data-slot="${slot}"[^>]*>`);
  const match = markup.match(pattern);
  return match?.[0] ?? '';
};

test('ScrollArea root clamps overflow and preserves rounding', () => {
  const html = renderToStaticMarkup(
    <ScrollArea className="max-h-64 rounded-lg">
      <div className="h-[999px] w-full" />
    </ScrollArea>,
  );

  const root = extractElementBySlot(html, 'scroll-area');
  assert.ok(root.includes('overflow-hidden'));
  assert.ok(root.includes('rounded-[inherit]'));
  assert.ok(root.includes('rounded-lg'));
  assert.ok(!root.includes('pr-'));
});

test('ScrollArea viewport accepts custom className', () => {
  const html = renderToStaticMarkup(
    <ScrollArea viewportClassName="pr-4">
      <div className="h-[999px] w-full" />
    </ScrollArea>,
  );

  const viewport = extractElementBySlot(html, 'scroll-area-viewport');
  assert.ok(viewport.includes('h-full'));
  assert.ok(viewport.includes('w-full'));
  assert.ok(viewport.includes('pr-4'));
});
