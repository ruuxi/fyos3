import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Store, Monitor, Image as ImageIcon, Home, RotateCcw } from 'lucide-react';

export type ToolbarProps = {
  activeIndex: number;
  onToggleHomeStore: () => void;
  onVisit: () => void;
  onMedia: () => void;
  canUndo?: boolean;
  onUndo?: () => void;
};

export default function Toolbar({ activeIndex, onToggleHomeStore, onVisit, onMedia, canUndo, onUndo }: ToolbarProps) {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-10 w-10 rounded-none text-white hover:bg-white/10 disabled:opacity-40" 
              onClick={onUndo}
              disabled={!canUndo}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="rounded-none">
            Undo last agent changes
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-10 w-10 rounded-none text-white hover:bg-white/10" 
              onClick={onToggleHomeStore}
            >
              {activeIndex === 0 ? (
                <Home className="h-4 w-4" />
              ) : (
                <Store className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent className="rounded-none">
            {activeIndex === 0 ? 'Back to Desktop' : 'App Store'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none text-white hover:bg-white/10" onClick={onVisit}>
              <Monitor className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="rounded-none">Visit Desktops</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10 rounded-none text-white hover:bg-white/10" onClick={onMedia}>
              <ImageIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="rounded-none">Media</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}


