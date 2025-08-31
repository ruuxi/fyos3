"use client";

export function DesktopShell() {
  const slots = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="relative h-[calc(100dvh-var(--agentbar-height,56px))] w-full overflow-hidden rounded-none sm:rounded-xl border bg-background">
      <div className="relative h-full w-full p-4 grid content-start gap-6 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
        {slots.map((i) => (
          <div key={i} className="rounded-xl border border-dashed aspect-square" />
        ))}
      </div>
    </div>
  );
}

export default DesktopShell;


