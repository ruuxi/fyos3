export const STYLING_PROMPT = `## Styling & Layout Guidelines

### Window Context
- Apps live in resizable windows (~600x380). Wrap everything in \`<div class="h-full overflow-auto">\` to keep scrolling internal.
- Use flex or \`h-full\` instead of viewport hacks, and scope sticky headers to the window.

### Design Philosophy: Context-Aware Styling
**CRITICAL:** Don't create plain, unstyled apps. Always apply thoughtful styling that matches the user's intent:

**App Purpose Analysis:**
- **Productivity apps** (notes, todo, calculator): Clean, focused layouts with subtle shadows, proper spacing, muted colors
- **Creative apps** (drawing, music, photo): Bold colors, larger interactive areas, visual feedback
- **Data apps** (dashboards, analytics): Structured grids, clear hierarchy, data visualization colors
- **Entertainment apps** (games, media): Vibrant colors, engaging animations, playful elements
- **Utility apps** (settings, file manager): Organized sections, clear icons, functional aesthetics

**Styling Requirements:**
1. **Color Palette**: Choose colors that match the app's purpose (e.g., green/blue for finance, warm colors for creative tools)
2. **Typography**: Use appropriate font weights and sizes for hierarchy
3. **Spacing**: Generous padding/margins for readability, tighter spacing for data-dense apps
4. **Interactive polish**: Add hover/loading feedback with subtle shadows, rounded corners, and strong contrast.

### Component Library
**Available shadcn/ui components:**
- Button, Badge, Card (CardHeader, CardTitle, CardDescription, CardContent, CardFooter)
- DropdownMenu, Input, Select, Tabs, Textarea

**Import syntax:** \`import { Button } from "@/components/ui/button"\`

**If not listed above, add new components:** Use \`web_exec\` with \`pnpm dlx shadcn@latest add [component-name]\`

**Tailwind Styling Examples:**
- **Headers**: \`bg-gradient-to-r from-blue-500 to-purple-600 text-white p-4 rounded-t-lg\`
- **Cards**: \`bg-white shadow-lg rounded-xl border border-gray-200 p-6\`
- **Buttons**: \`bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors\`
- **Input focus**: \`focus:ring-2 focus:ring-blue-500 focus:border-blue-500\`

**Avoid:** Injecting global CSS, using default browser styling

### App-Specific Styling with styles.css
**Each app has its own \`styles.css\` file that should be customized:**

**Purpose of \`styles.css\`:**
- Define app-specific CSS variables for theming
- Override component styles that can't be achieved with Tailwind
- Add custom animations and transitions
- Define app-specific utility classes

**CSS Variables Pattern (Required):**
\`\`\`css
:root {
  --app-accent: #your-accent-color;
  --app-background: #your-bg-color;
  --app-text: #your-text-color;
  --app-border: #your-border-color;
  --app-hover: #your-hover-color;
}
\`\`\`

**Common styles.css Patterns:**
\`\`\`css
/* Theme variables based on app purpose */
:root {
  --app-accent: #3b82f6; /* Blue for productivity */
  --app-secondary: #64748b;
  --app-success: #10b981;
  --app-warning: #f59e0b;
  --app-error: #ef4444;
}

/* App-specific component overrides */
.app-button {
  background: var(--app-accent);
  transition: all 0.2s ease;
}

.app-button:hover {
  background: var(--app-hover);
  transform: translateY(-1px);
}

/* Custom animations */
@keyframes slideIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.app-fade-in {
  animation: slideIn 0.3s ease-out;
}
\`\`\`

**When to modify styles.css:** Theme setup, custom hover/animation work, app-specific utilities, and overrides Tailwind can't handle.

### Styling Implementation Strategy
**Before coding**, confirm the app category, target aesthetic, and key interactions, then align palette, layout density, hierarchy, and micro-interactions with that context.

**Example Decision Process:**
- User asks for "expense tracker" → Finance app → Use green/blue palette, clean tables, clear CTAs
- User asks for "drawing app" → Creative tool → Vibrant colors, large canvas area, tool palettes
- User asks for "dashboard" → Data app → Structured grid, charts, neutral colors with accent highlights`;
