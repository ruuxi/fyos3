### FYOS AI Integration: FAL + ElevenLabs — Research, Design, and Implementation Guide

This document explains how FYOS wires AI features into apps without exposing API keys on the client. It documents the current bridge, how assets are persisted, and provides ready‑to‑use wrappers and examples to add many new modalities (image→video, image→image, image→3D, video→video, text→video, speech→speech, text→avatar, text→audio, sound effects, reference→video, video→audio, video foley, etc.).

### Architecture Overview

- Client apps (inside the WebContainer iframe) import helpers from `src/ai` (aliased within template Vite app at `/src/ai`).
- Helpers post a message to the Next.js host (`AI_REQUEST`) with `{ provider, model, input }`.
- The host (`src/components/WebContainer.tsx`) receives `AI_REQUEST`, calls a server proxy:
  - FAL → `POST /api/ai/fal` with `{ model, input }`
  - ElevenLabs → `POST /api/ai/eleven` with input payload
- The proxy uses server‑side API keys (`FAL_API_KEY`, `ELEVENLABS_API_KEY`). Clients never touch secrets.
- The host then runs `persistAssetsFromAIResult` to detect any media URLs or base64 and stores them via `/api/media/ingest` (R2), replacing URLs/base64 in the result with durable `publicUrl` links and returning them to the app.

Key files:
- `src/components/WebContainer.tsx` — AI message bridge
- `src/app/api/ai/fal/route.ts` — FAL proxy
- `src/app/api/ai/eleven/route.ts` — ElevenLabs proxy
- `src/utils/ai-media.ts` — Persist results (auto-ingest media URLs/base64)
- `templates/webcontainer/src/ai/index.ts` — Client helper API used by apps

### Current Patterns

- FAL proxy is generic: pass model path and JSON input to `https://fal.run/<model>` and return JSON.
- ElevenLabs proxy targets `https://api.elevenlabs.io/v1/music` with optional raw/binary handling → converted to base64 when non‑JSON.
- The bridge persists `url` fields and ElevenLabs `audioBase64` via `/api/media/ingest`, replacing with `publicUrl`.

### Adding New Modalities (Model Catalog)

Below are suggested wrappers (client-side) that call the existing bridge. Each wrapper maps a typed input to the underlying FAL route. You can call any FAL model by path via `callFal(model, input)`, but wrappers improve DX and guard parameter shapes. Use the model docs referenced.

Models and docs referenced:
- Argil Avatars Audio→Video: `argil/avatars/audio-to-video` — [`link`](https://fal.ai/models/argil/avatars/audio-to-video/api)
- Tripo3D Image→3D: `tripo3d/tripo/v2.5/image-to-3d` — [`link`](https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/api)
- Tripo3D Multiview→3D: `tripo3d/tripo/v2.5/multiview-to-3d` — [`link`](https://fal.ai/models/tripo3d/tripo/v2.5/multiview-to-3d/api)
- Qwen Image to Image: `fal-ai/qwen-image/image-to-image` — [`link`](https://fal.ai/models/fal-ai/qwen-image/image-to-image/api)
- Qwen Image Edit: `fal-ai/qwen-image-edit` — [`link`](https://fal.ai/models/fal-ai/qwen-image-edit/api)
- PixVerse Transition: `fal-ai/pixverse/v5/transition` — [`link`](https://fal.ai/models/fal-ai/pixverse/v5/transition)
- ByteDance SeeDance Image→Video: `fal-ai/bytedance/seedance/v1/lite/image-to-video` — [`link`](https://fal.ai/models/fal-ai/bytedance/seedance/v1/lite/image-to-video/api)
- ByteDance SeeDance Reference→Video: `fal-ai/bytedance/seedance/v1/lite/reference-to-video` — [`link`](https://fal.ai/models/fal-ai/bytedance/seedance/v1/lite/reference-to-video/api)
- Chatterbox Speech→Speech: `fal-ai/chatterbox/speech-to-speech` — [`link`](https://fal.ai/models/fal-ai/chatterbox/speech-to-speech/api)
- ElevenLabs SFX v2: `fal-ai/elevenlabs/sound-effects/v2` — [`link`](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api)
- Lyria2 (music): `fal-ai/lyria2` — [`link`](https://fal.ai/models/fal-ai/lyria2/api)
- Chatterbox Text→Speech Multilingual: `fal-ai/chatterbox/text-to-speech/multilingual` — [`link`](https://fal.ai/models/fal-ai/chatterbox/text-to-speech/multilingual/api)
- WAN Text→Video Fast: `fal-ai/wan/v2.2-5b/text-to-video/fast-wan` — [`link`](https://fal.ai/models/fal-ai/wan/v2.2-5b/text-to-video/fast-wan/api)
- Mirelo SFX V1 Video→Audio: `mirelo-ai/sfx-v1/video-to-audio` — [`link`](https://fal.ai/models/mirelo-ai/sfx-v1/video-to-audio/api)
- WAN Video→Video: `fal-ai/wan/v2.2-a14b/video-to-video` — [`link`](https://fal.ai/models/fal-ai/wan/v2.2-a14b/video-to-video/api)
- Hunyuan Video Foley: `fal-ai/hunyuan-video-foley` — [`link`](https://fal.ai/models/fal-ai/hunyuan-video-foley/api)

Note: exact fields are per-model. The bridge auto-uploads files when the SDK is used, but we are posting JSON to the REST proxy; for file inputs, prefer passing public URLs. Use `/api/media/ingest` first to host any local files, then pass `publicUrl` to FAL inputs.

### Client Wrappers (to add in `/src/ai`)

Conceptually, apps will do:

```ts
import { callFal } from "/src/ai";
await callFal("fal-ai/wan/v2.2-5b/text-to-video/fast-wan", { prompt: "a city at night" });
``)

Provide typed helpers for common flows to improve developer experience:

- Image→Video (SeeDance):
```ts
await callFal("fal-ai/bytedance/seedance/v1/lite/image-to-video", {
  image_url: "https://.../image.jpg",
  // additional params per model: fps, motion_scale, seed, etc.
});
```

- Reference→Video (SeeDance):
```ts
await callFal("fal-ai/bytedance/seedance/v1/lite/reference-to-video", {
  reference_image_url: "https://.../ref.png",
  target_video_prompt: "person walking on beach"
});
```

- Image→Image (Qwen):
```ts
await callFal("fal-ai/qwen-image/image-to-image", {
  image_url: "https://.../image.png",
  prompt: "make it watercolor style"
});
```

- Image Edit (Qwen edit):
```ts
await callFal("fal-ai/qwen-image-edit", {
  image_url: "https://.../image.png",
  instruction: "remove the background"
});
```

- Text→Video (WAN fast):
```ts
await callFal("fal-ai/wan/v2.2-5b/text-to-video/fast-wan", {
  prompt: "a drone shot over mountains at sunset"
});
```

- Video→Video (WAN):
```ts
await callFal("fal-ai/wan/v2.2-a14b/video-to-video", {
  video_url: "https://.../input.mp4",
  prompt: "anime style"
});
```

- Audio→Video (Argil Avatars):
```ts
await callFal("argil/avatars/audio-to-video", {
  avatar: "Noemie car (UGC)",
  audio_url: { url: "https://.../voice.mp3" },
  remove_background: false,
});
```

- Text→Avatar (use Chatterbox TTS + Argil avatar, or a text-to-video model):
  1) Generate TTS: `fal-ai/chatterbox/text-to-speech/multilingual`
  2) Feed `audio_url` into Argil avatar model above.

- Speech→Speech (Chatterbox):
```ts
await callFal("fal-ai/chatterbox/speech-to-speech", {
  source_audio_url: "https://.../input.wav",
  target_voice: "..."
});
```

- Text→Audio (Chatterbox TTS Multilingual):
```ts
await callFal("fal-ai/chatterbox/text-to-speech/multilingual", {
  text: "Hello world",
  language: "en",
  voice: "...",
});
```

- Text→Sound Effects (ElevenLabs SFX v2 via FAL):
```ts
await callFal("fal-ai/elevenlabs/sound-effects/v2", {
  prompt: "arcade coin insert, retro, crisp"
});
```

- Music (Lyria2):
```ts
await callFal("fal-ai/lyria2", { prompt: "epic orchestral rise", length_seconds: 60 });
```

- Video→Audio (Mirelo SFX V1):
```ts
await callFal("mirelo-ai/sfx-v1/video-to-audio", { video_url: "https://.../input.mp4" });
```

- Video Foley (Hunyuan):
```ts
await callFal("fal-ai/hunyuan-video-foley", { video_url: "https://.../input.mp4" });
```

- Image→3D (Tripo3D):
```ts
await callFal("tripo3d/tripo/v2.5/image-to-3d", {
  image_url: "https://.../image.jpg",
  texture: "standard", // or "HD", "no"
  texture_alignment: "original_image",
  orientation: "default"
});
```

- Multiview→3D (Tripo3D):
```ts
await callFal("tripo3d/tripo/v2.5/multiview-to-3d", {
  image_urls: ["https://.../view1.jpg", "https://.../view2.jpg"],
  // params per model docs
});
```

### Server Proxies

- FAL proxy already generic. For non‑JSON responses in future models, ensure we handle binary payloads. Current listed FAL models return JSON with file URLs (which we ingest automatically).
- ElevenLabs proxy targets music. For SFX via FAL, continue using the FAL proxy rather than direct ElevenLabs route.

### Media Persistence and Allowed Origins

- `/api/media/ingest` only permits trusted hosts. Ensure FAL media hosts used by models are included. If outputs use `https://v3.fal.media/...`, add that prefix.
- The persist step searches deeply in results for `url` fields and arrays (`images`, `videos`, etc.), and replaces them with durable `publicUrl` in our R2, so apps can safely render and store references.

### Agent Prompt: Code Examples for Apps

Add concise examples in `src/app/api/agent/route.ts` system prompt under "AI Integration in Apps" so the agent generates the correct usage:

```ts
import { callFal } from "/src/ai";

// Text to Video (WAN)
await callFal("fal-ai/wan/v2.2-5b/text-to-video/fast-wan", { prompt: "a neon city timelapse" });

// Image to Video (SeeDance)
await callFal("fal-ai/bytedance/seedance/v1/lite/image-to-video", { image_url: "https://.../img.jpg" });

// Image to 3D (Tripo3D)
await callFal("tripo3d/tripo/v2.5/image-to-3d", { image_url: "https://.../img.jpg", texture: "standard" });

// Audio to Video (Avatar)
await callFal("argil/avatars/audio-to-video", { avatar: "Noemie car (UGC)", audio_url: { url: "https://.../voice.mp3" } });

// Text to Speech (Chatterbox)
await callFal("fal-ai/chatterbox/text-to-speech/multilingual", { text: "Hello", language: "en" });

// Sound Effects (ElevenLabs via FAL)
await callFal("fal-ai/elevenlabs/sound-effects/v2", { prompt: "sci-fi door open" });
```

### Implementation Steps

1) Extend `templates/webcontainer/src/ai/index.ts` with convenience wrappers: exported functions that simply call `callFal()` with specific model paths and typed inputs. Keep them small to prevent bundle bloat.
2) Update `src/app/api/media/ingest/route.ts` to allow additional FAL media host (`https://v3.fal.media/`).
3) Update the agent prompt examples in `src/app/api/agent/route.ts` in the AI Integration section.
4) Validate by generating media from a sample app and confirming assets land in Media Library.

### Notes and Caveats

- Avoid passing raw files from the iframe; first upload via `/api/media/ingest` to get `publicUrl`, then use that URL in FAL inputs. This avoids client‑side secrets and simplifies larger payload handling.
- Some models have queues; the REST proxy returns job results as JSON when complete. For truly long jobs, consider adding webhook support later.
- Prices and availability may change. The wrappers remain generic so swapping model paths is trivial.

### References

- Avatars Audio→Video — [`https://fal.ai/models/argil/avatars/audio-to-video/api`](https://fal.ai/models/argil/avatars/audio-to-video/api)
- Image→3D — [`https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/api`](https://fal.ai/models/tripo3d/tripo/v2.5/image-to-3d/api)
- Multiview→3D — [`https://fal.ai/models/tripo3d/tripo/v2.5/multiview-to-3d/api`](https://fal.ai/models/tripo3d/tripo/v2.5/multiview-to-3d/api)
- Image→Image — [`https://fal.ai/models/fal-ai/qwen-image/image-to-image/api`](https://fal.ai/models/fal-ai/qwen-image/image-to-image/api)
- Image Edit — [`https://fal.ai/models/fal-ai/qwen-image-edit/api`](https://fal.ai/models/fal-ai/qwen-image-edit/api)
- PixVerse Transition — [`https://fal.ai/models/fal-ai/pixverse/v5/transition`](https://fal.ai/models/fal-ai/pixverse/v5/transition)
- Image→Video — [`https://fal.ai/models/fal-ai/bytedance/seedance/v1/lite/image-to-video/api`](https://fal.ai/models/fal-ai/bytedance/seedance/v1/lite/image-to-video/api)
- Reference→Video — [`https://fal.ai/models/fal-ai/bytedance/seedance/v1/lite/reference-to-video/api`](https://fal.ai/models/fal-ai/bytedance/seedance/v1/lite/reference-to-video/api)
- Speech→Speech — [`https://fal.ai/models/fal-ai/chatterbox/speech-to-speech/api`](https://fal.ai/models/fal-ai/chatterbox/speech-to-speech/api)
- Sound Effects — [`https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api`](https://fal.ai/models/fal-ai/elevenlabs/sound-effects/v2/api)
- Lyria2 — [`https://fal.ai/models/fal-ai/lyria2/api`](https://fal.ai/models/fal-ai/lyria2/api)
- Text→Speech — [`https://fal.ai/models/fal-ai/chatterbox/text-to-speech/multilingual/api`](https://fal.ai/models/fal-ai/chatterbox/text-to-speech/multilingual/api)
- Fast WAN T2V — [`https://fal.ai/models/fal-ai/wan/v2.2-5b/text-to-video/fast-wan/api`](https://fal.ai/models/fal-ai/wan/v2.2-5b/text-to-video/fast-wan/api)
- Video→Audio — [`https://fal.ai/models/mirelo-ai/sfx-v1/video-to-audio/api`](https://fal.ai/models/mirelo-ai/sfx-v1/video-to-audio/api)
- WAN V2V — [`https://fal.ai/models/fal-ai/wan/v2.2-a14b/video-to-video/api`](https://fal.ai/models/fal-ai/wan/v2.2-a14b/video-to-video/api)
- Hunyuan Foley — [`https://fal.ai/models/fal-ai/hunyuan-video-foley/api`](https://fal.ai/models/fal-ai/hunyuan-video-foley/api)


