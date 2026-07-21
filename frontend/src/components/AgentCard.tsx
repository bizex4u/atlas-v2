import { motion } from 'framer-motion';
import type { AgentName, AgentStatus } from '@atlas/shared';
import type { AgentCardState } from '../hooks/useResearchStream';

type AgentCardProps = {
  name: AgentName;
  state: AgentCardState;
};

function StatusIcon({ status }: { status: AgentStatus }) {
  if (status === 'running') {
    return (
      <span
        className="relative flex h-4 w-4 items-center justify-center"
        aria-hidden
      >
        <span className="absolute inset-0 animate-spin rounded-full border-[1.5px] border-atlas-accent/30 border-t-atlas-accent" />
      </span>
    );
  }

  if (status === 'done') {
    return (
      <span
        className="flex h-4 w-4 items-center justify-center text-atlas-success"
        aria-hidden
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.25" fill="currentColor" opacity="0.2" />
          <path
            d="M4 7.2l2 2 4-4.4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span
        className="flex h-4 w-4 items-center justify-center text-atlas-danger"
        aria-hidden
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M5 5l4 4M9 5l-4 4"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </span>
    );
  }

  return (
    <span
      className="flex h-4 w-4 items-center justify-center text-atlas-muted/50"
      aria-hidden
    >
      <span className="h-3.5 w-3.5 rounded-full border border-current" />
    </span>
  );
}

export function AgentCard({ name, state }: AgentCardProps) {
  const isRunning = state.status === 'running';

  return (
    <motion.div
      layout
      initial={{ opacity: 0.55, scale: 0.97 }}
      animate={{
        opacity: 1,
        scale: isRunning ? [1, 1.02, 1] : 1,
      }}
      transition={
        isRunning
          ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.35, ease: 'easeOut' }
      }
      className={[
        'relative overflow-hidden rounded-xl border px-4 py-4 backdrop-blur-md',
        isRunning
          ? 'border-atlas-accent/35 bg-atlas-accent/10 shadow-[0_0_28px_rgba(124,58,237,0.12)]'
          : state.status === 'done'
            ? 'border-white/10 bg-white/[0.05]'
            : state.status === 'failed'
              ? 'border-atlas-danger/30 bg-atlas-danger/5'
              : 'border-white/[0.06] bg-white/[0.03]',
      ].join(' ')}
    >
      <div className="flex items-center gap-2.5">
        <StatusIcon status={state.status} />
        <p className="text-[14px] font-medium tracking-[0.14em] text-atlas-text/90 uppercase">
          {name}
        </p>
      </div>

      <div className="mt-3 min-h-[1.25rem]">
        {state.status === 'done' && state.detail ? (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="text-xs leading-relaxed text-atlas-muted"
          >
            {state.detail}
          </motion.p>
        ) : state.status === 'running' ? (
          <p className="text-xs text-atlas-accent-soft/80">Working…</p>
        ) : state.status === 'failed' ? (
          <p className="text-xs text-atlas-danger/80">
            {state.detail ?? 'Failed'}
          </p>
        ) : (
          <p className="text-xs text-atlas-muted/40">Waiting</p>
        )}
      </div>
    </motion.div>
  );
}
