import { motion } from 'framer-motion';

/** Slow-moving purple/navy blobs at ~10–15% opacity, heavily blurred. */
export function AnimatedBackground() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -top-[20%] -left-[10%] h-[55vmin] w-[55vmin] rounded-full bg-atlas-accent"
        style={{ opacity: 0.12, filter: 'blur(100px)' }}
        animate={{
          x: [0, 60, -20, 0],
          y: [0, 40, -30, 0],
          scale: [1, 1.15, 0.95, 1],
        }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-[35%] -right-[15%] h-[50vmin] w-[50vmin] rounded-full bg-[#1e1b4b]"
        style={{ opacity: 0.15, filter: 'blur(110px)' }}
        animate={{
          x: [0, -50, 30, 0],
          y: [0, -35, 45, 0],
          scale: [1, 0.9, 1.1, 1],
        }}
        transition={{ duration: 34, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-[15%] left-[25%] h-[45vmin] w-[45vmin] rounded-full bg-atlas-accent-soft"
        style={{ opacity: 0.1, filter: 'blur(120px)' }}
        animate={{
          x: [0, 40, -55, 0],
          y: [0, -50, 20, 0],
          scale: [1, 1.2, 0.92, 1],
        }}
        transition={{ duration: 40, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
