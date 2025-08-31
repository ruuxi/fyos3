"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Cog, Folder, MessageSquare, Play, Square } from "lucide-react";

export function AgentBar() {
  return (
    <TooltipProvider>
      <div className="fixed bottom-2 left-0 right-0 z-50 flex justify-center px-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-5xl rounded-2xl border bg-background/80 supports-[backdrop-filter]:bg-background/60 backdrop-blur shadow-lg">
          <div className="flex items-center gap-3 p-3">
            <div className="flex items-center gap-3 pr-1">
              <Avatar className="size-8">
                <AvatarImage src="/agent.png" alt="Agent" />
                <AvatarFallback>AI</AvatarFallback>
              </Avatar>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Agent</span>
                <Badge variant="secondary" className="text-xs">Idle</Badge>
              </div>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <div className="mx-auto flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="secondary">
                    <MessageSquare className="size-4 mr-2" />
                    Chat
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Open agent chat</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="default">
                    <Play className="size-4 mr-2" />
                    Start
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Start a task</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Square className="size-4 mr-2" />
                    Stop
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Stop current task</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Folder className="size-4 mr-2" />
                    FS
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Open virtual file system</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <div className="pl-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="ghost">
                    <Cog className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Agent settings</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default AgentBar;


