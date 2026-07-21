import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';

type SearchScreenProps = {
  onSubmit: (brandName: string) => void;
};

export function SearchScreen({ onSubmit }: SearchScreenProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputId = useId();

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  return (
    <motion.div
      className="relative z-10 flex w-full max-w-3xl flex-col items-center px-6"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <form onSubmit={handleSubmit} className="w-full">
        <label htmlFor={inputId} className="sr-only">
          Brand name
        </label>
        <div className="relative flex items-end gap-3">
          <input
            id={inputId}
            type="text"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder="Enter a brand name…"
            className="w-full bg-transparent text-[clamp(3rem,8vw,4rem)] leading-none font-semibold tracking-[-0.04em] text-atlas-text outline-none placeholder:text-atlas-muted/45"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Start research"
            className="mb-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-atlas-muted transition-colors enabled:hover:text-atlas-accent enabled:focus-visible:text-atlas-accent disabled:opacity-25"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <div
          className="mt-3 h-px w-full transition-[box-shadow,background-color] duration-300"
          style={{
            backgroundColor: focused
              ? 'rgba(124, 58, 237, 0.55)'
              : 'rgba(42, 45, 58, 0.9)',
            boxShadow: focused
              ? '0 0 18px 1px rgba(124, 58, 237, 0.45)'
              : 'none',
          }}
        />
      </form>

      <p className="mt-8 text-[11px] tracking-[0.04em] text-atlas-muted/70">
        Atlas · Market Intelligence
      </p>
    </motion.div>
  );
}
