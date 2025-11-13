import type { RefObject, ReactNode } from 'react';

export type AgentBarShellProps = {
  isOpen: boolean;
  isOpening: boolean;
  isClosing: boolean;
  onBackdropClick: () => void;
  barAreaRef?: RefObject<HTMLDivElement | null>;
  dragOverlay?: ReactNode;
  bottomBar?: ReactNode;
  navBar?: ReactNode;
  children: ReactNode;
};

export default function AgentBarShell(props: AgentBarShellProps) {
  const { isOpen, isOpening, isClosing, onBackdropClick: _onBackdropClick, barAreaRef, dragOverlay, bottomBar, navBar, children } = props;

  return (
    <>
      {dragOverlay}
      <div className="fixed inset-0 z-40 pointer-events-none" aria-hidden="true" />
      <div className="fixed inset-y-0 left-0 z-50 flex">
        <div className="relative h-full w-[400px]" ref={barAreaRef}>
          <div className="absolute inset-0 pointer-events-none" style={{ background: '#0a1628' }} />
          <div className={`relative flex h-full flex-col overflow-hidden text-white ${isOpen ? 'glass-secondary' : 'glass-primary'} transition-shadow`}>
            <div
              className={`grid flex-auto min-h-0 origin-left will-change-[transform] transition-[grid-template-rows,transform] ${isOpening ? 'duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : isClosing ? 'duration-[220ms] ease-[cubic-bezier(0.4,0,1,1)]' : 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'} ${isOpen ? 'grid-rows-[1fr] translate-x-0 scale-100' : 'grid-rows-[0fr] -translate-x-1 scale-[0.995]'} motion-reduce:transition-none`}
              aria-hidden={!isOpen}
            >
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="flex-1 min-h-0 overflow-hidden">
                  {children}
                </div>
              </div>
            </div>
            <div className="shrink-0">
              {navBar}
            </div>
            <div className="shrink-0">
              {bottomBar}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

