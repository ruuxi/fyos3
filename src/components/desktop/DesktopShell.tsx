"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Folder, FileText, TerminalSquare } from "lucide-react";

type DesktopApp = {
  id: string;
  name: string;
  icon: React.ReactNode;
};

export function DesktopShell() {
  const apps: DesktopApp[] = useMemo(
    () => [
      { id: "files", name: "Files", icon: <Folder className="size-5" /> },
      { id: "notes", name: "Notes", icon: <FileText className="size-5" /> },
      { id: "terminal", name: "Terminal", icon: <TerminalSquare className="size-5" /> },
    ],
    []
  );

  return (
    <div className="relative h-[calc(100dvh-var(--agentbar-height,56px))] w-full overflow-hidden rounded-none sm:rounded-xl border bg-background">
      <div className="absolute inset-0 bg-gradient-to-br from-muted/40 to-background" />

      <div className="relative h-full w-full p-4 grid content-start gap-6 grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
        {apps.map((app) => (
          <div
            key={app.id}
            className={cn(
              "group flex flex-col items-center justify-center gap-2 select-none cursor-default",
              "rounded-lg p-3 hover:bg-accent/50"
            )}
          >
            <div className="flex items-center justify-center size-14 rounded-xl border bg-card shadow-sm group-hover:shadow">
              {app.icon}
            </div>
            <span className="text-xs text-muted-foreground group-hover:text-foreground">
              {app.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default DesktopShell;


