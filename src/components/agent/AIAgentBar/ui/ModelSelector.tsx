"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ModelSelectorProps = {
  open: boolean;
  onClose: () => void;
};

type ProviderKey = "fal" | "eleven";

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  fal: "FAL (images/video/music)",
  eleven: "ElevenLabs (audio/voice)",
};

const LS_KEYS = {
  provider: "fyos.ai.provider",
  model: "fyos.ai.model",
} as const;

export default function ModelSelector({ open, onClose }: ModelSelectorProps) {
  const [provider, setProvider] = useState<ProviderKey>("fal");
  const [model, setModel] = useState<string>("");

  // Load persisted selection
  useEffect(() => {
    if (!open) return;
    try {
      const p = (localStorage.getItem(LS_KEYS.provider) || "fal") as ProviderKey;
      const m = localStorage.getItem(LS_KEYS.model) || "";
      setProvider(p);
      setModel(m);
    } catch {}
  }, [open]);

  const suggestions = useMemo(() => {
    if (provider === "fal") {
      return [
        "fal-ai/stable-diffusion-xl",
        "fal-ai/flux-lora",
        "fal-ai/video-portraits",
        "fal-ai/music-generation",
      ];
    }
    return [
      "elevenlabs/voice-v2",
      "elevenlabs/voice-v2-turbo",
    ];
  }, [provider]);

  const save = () => {
    try {
      localStorage.setItem(LS_KEYS.provider, provider);
      localStorage.setItem(LS_KEYS.model, model.trim());
      window.dispatchEvent(
        new CustomEvent("model-selection-changed", { detail: { provider, model: model.trim() } })
      );
    } catch {}
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white text-black p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Model selection"
      >
        <div className="text-lg font-semibold mb-2">Select Model</div>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-gray-700 mb-1">Provider</div>
            <div className="flex items-center gap-3">
              {(["fal", "eleven"] as ProviderKey[]).map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="provider"
                    value={p}
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                  />
                  <span>{PROVIDER_LABELS[p]}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-700 mb-1">Model (optional)</div>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={provider === "fal" ? "e.g. fal-ai/stable-diffusion-xl" : "e.g. elevenlabs/voice-v2"}
              className="rounded-none"
            />
            {suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setModel(s)}
                    className="text-xs px-2 py-1 border border-gray-300 hover:bg-gray-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" className="rounded-none" onClick={onClose}>Cancel</Button>
          <Button className="rounded-none" onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );
}

