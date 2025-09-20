import type { RefObject, ReactNode } from 'react';

export type AgentBarShellProps = {
  isOpen: boolean;
  isOpening: boolean;
  isClosing: boolean;
  onBackdropClick: () => void;
  barAreaRef?: RefObject<HTMLDivElement | null>;
  dragOverlay?: ReactNode;
  bottomBar?: ReactNode;
  children: ReactNode;
};

export default function AgentBarShell(props: AgentBarShellProps) {
  const { isOpen, isOpening, isClosing, onBackdropClick, barAreaRef, dragOverlay, bottomBar, children } = props;

  return (
    <>
      {dragOverlay}
      <div
        className={`fixed inset-0 z-40 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
        onClick={onBackdropClick}
        aria-hidden="true"
      />
      <div className="fixed bottom-0 left-0 right-0 flex justify-center z-50">
        <div className="w-full max-w-5xl mx-4 relative" ref={barAreaRef}>
          <div className={`rounded-none text-white ${isOpen ? 'glass-secondary' : 'glass-primary'} transition-shadow overflow-hidden`}>
            <div className="flex flex-col-reverse">
              {/* Bottom bar (fixed) */}
              {bottomBar}
              {/* Expansion content above the bar */}
              <div
                className={`grid origin-bottom will-change-[transform] transition-[grid-template-rows,transform] ${isOpening ? 'duration-[340ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : isClosing ? 'duration-[220ms] ease-[cubic-bezier(0.4,0,1,1)]' : 'duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'} ${isOpen ? 'grid-rows-[1fr] translate-y-0 scale-100' : 'grid-rows-[0fr] translate-y-1 scale-[0.995]'} motion-reduce:transition-none`}
                aria-hidden={!isOpen}
              >
                <div className="overflow-hidden" style={{ maxHeight: '70vh' }}>
                  {children}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

