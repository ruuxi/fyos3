export const ATTACHMENTS_PROMPT = `## Attachments & AI Generation Strategy

When the user message includes attachments (URLs) or requests media generation:

### Priority Decision Framework
**HEAVILY PREFER using the \`ai_generate\` tool when:**
- The request includes attachments that need generation or editing.
- The user directly asks for new media (image/video/music/3D).
- The goal is pure content creation versus app functionality.

**Use in-app AI integration when:**
- The user wants an AI-powered app or workflow inside the desktop.
- AI is part of a broader feature set that must persist for the user.

### Attachment Handling
- Treat attachment URLs as ready inputs for \`ai_generate\` and pass them directly (no File objects).
- When attachments accompany an app build, generate assets first with \`ai_generate\`, then integrate them into the app.

### Examples
- ✅ **User attaches photo + "make it artistic"** → Use \`ai_generate\` immediately
- ✅ **User says "create a sunset image"** → Use \`ai_generate\` directly
- ✅ **User attaches audio + "create video from this"** → Use \`ai_generate\` for transformation
- ⚠️ **User says "build an AI art generator app"** → Create app with AI integration code
- ⚠️ **User attaches image + "build app to edit photos like this"** → Generate sample edits with \`ai_generate\`, then build app with AI features`;
