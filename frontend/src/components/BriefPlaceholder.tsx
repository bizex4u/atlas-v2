import { motion } from 'framer-motion';

type BriefPlaceholderProps = {
  brandName: string;
};

/** Stage 3 placeholder — real brief screens land in Stage 7. */
export function BriefPlaceholder({ brandName }: BriefPlaceholderProps) {
  return (
    <motion.div
      className="relative z-10 flex min-h-full w-full flex-col items-center justify-center px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      <p className="text-xs tracking-[0.22em] text-atlas-muted uppercase">
        Campaign brief
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight text-atlas-text sm:text-5xl">
        {brandName}
      </h1>
      <p className="mt-5 max-w-md text-center text-base text-atlas-muted">
        Brief coming in Stage 7
      </p>
    </motion.div>
  );
}
