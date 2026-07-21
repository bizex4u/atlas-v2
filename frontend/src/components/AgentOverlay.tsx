import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AgentCard } from './AgentCard';
import {
  AGENT_ORDER,
  useResearchStream,
} from '../hooks/useResearchStream';

type AgentOverlayProps = {
  brandName: string;
  onComplete: () => void;
  onBack?: () => void;
};

export function AgentOverlay({
  brandName,
  onComplete,
  onBack,
}: AgentOverlayProps) {
  const { agents, statusText, succeeded, error, displayBrand } =
    useResearchStream(brandName, true);
  const completedRef = useRef(false);

  useEffect(() => {
    // Only dismiss overlay after a validated successful brief
    if (!succeeded || completedRef.current) return;
    completedRef.current = true;
    const timer = window.setTimeout(() => {
      onComplete();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [succeeded, onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-20 flex flex-col overflow-y-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[#0A0B0F]/95 backdrop-blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.08),transparent_50%)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-10 sm:py-14">
        <p className="text-center text-2xl font-medium tracking-tight text-atlas-muted">
          {displayBrand || brandName}
        </p>

        <div className="mt-8 text-center sm:mt-10">
          <AnimatePresence mode="wait">
            <motion.p
              key={statusText}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28 }}
              className="text-[clamp(2.5rem,6vw,3rem)] leading-tight font-semibold tracking-[-0.03em] text-atlas-text"
            >
              {statusText}
            </motion.p>
          </AnimatePresence>
          {error ? (
            <div className="mx-auto mt-5 max-w-xl">
              <p className="text-sm leading-relaxed text-atlas-danger">{error}</p>
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="mt-5 text-sm text-atlas-muted underline-offset-4 transition-colors hover:text-atlas-accent hover:underline"
                >
                  ← Back to search
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-3 sm:mt-14 sm:grid-cols-3 sm:gap-4">
          {AGENT_ORDER.map((name) => (
            <AgentCard key={name} name={name} state={agents[name]} />
          ))}
        </div>
      </div>
    </motion.div>
  );
}
