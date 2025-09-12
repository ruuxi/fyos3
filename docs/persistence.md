# Persistence: Private Desktop Snapshots and Chat History

This project now persists user data privately to Convex + R2 so that:

- Your WebContainer workspace (apps, files, registry) and desktop layout are saved and restored across devices.
- AI chat history is saved per user in server storage and loaded into the chat on login.

## Desktop (WebContainer) Persistence

Scope included in snapshot:
- All user files (excluding heavy/ephemeral directories like `node_modules`, `.pnpm`, `.turbo`, `.next`, etc.).
- App registry and user-created apps under `public/apps/registry.json` and `src/apps/*`.
- Desktop layout state written to `/public/_fyos/desktop-state.json` (icon positions, window geometries, window tabs) before each cloud save.

Client behavior (host):
- On boot, tries to restore from a private cloud snapshot for the authenticated user. If not available, falls back to IndexedDB persistence, then to the default binary snapshot.
- On tab hide and before unload, saves to IndexedDB and uploads a throttled private snapshot to Convex/R2.

Server storage:
- Convex table: `desktops_private` stores metadata and R2 key.
- R2 object: `desktops/private/{ownerId}/{desktopId}/snapshot.gz`.

Endpoints:
- `POST /api/user/desktops/save` – Uploads a snapshot (requires auth).
- `GET /api/user/desktops/latest` – Latest private snapshot + signed URL.
- `GET /api/user/desktops/[id]/url` – Signed URL for specific snapshot.

## Chat Persistence

Schema:
- `chat_threads(ownerId, title, createdAt, updatedAt, lastMessageAt)`
- `chat_messages(threadId, ownerId, role, content, createdAt)`

Endpoints:
- `POST /api/user/chat/threads` – Create a new thread (returns thread id).
- `GET /api/user/chat/threads?limit=N` – List threads.
- `GET /api/user/chat/messages?threadId=...&limit=N` – List messages.

Agent integration:
- The chat UI creates a default thread and stores its id in `localStorage('agent.threadId')`.
- On mount, the UI loads recent messages and seeds `useChat`.
- `/api/agent` writes the user and assistant messages to Convex when a `threadId` is provided (and the user is authenticated).

## Environment

Set the following in `.env.local`:

```
NEXT_PUBLIC_CONVEX_URL= https://<your-convex>.convex.cloud
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= pk_...
CLERK_SECRET_KEY= sk_...
CLERK_JWT_ISSUER_DOMAIN= <your-clerk-issuer-domain>
```

AI provider keys remain the same (see `.env.example`).

## Notes

- Apps are included in the private snapshot, so installed apps and the apps registry are restored on login.
- If unauthenticated, the app falls back to IndexedDB local persistence and the default snapshot.
- Cloud saves are throttled to once per 60 seconds, with a final attempt on page unload.

