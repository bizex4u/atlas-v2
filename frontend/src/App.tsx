import { useCallback, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { AnimatedBackground } from './components/AnimatedBackground';
import { SearchScreen } from './components/SearchScreen';
import { AgentOverlay } from './components/AgentOverlay';
import { BriefPlaceholder } from './components/BriefPlaceholder';

type AppView = 'search' | 'research' | 'brief';

export default function App() {
  const [view, setView] = useState<AppView>('search');
  const [brandName, setBrandName] = useState('');

  function handleSearch(name: string) {
    setBrandName(name);
    setView('research');
  }

  const handleResearchComplete = useCallback(() => {
    setView('brief');
  }, []);

  const handleBackToSearch = useCallback(() => {
    setView('search');
    setBrandName('');
  }, []);

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-atlas-bg">
      <AnimatedBackground />

      <AnimatePresence mode="wait">
        {view === 'search' ? (
          <SearchScreen key="search" onSubmit={handleSearch} />
        ) : view === 'research' ? (
          <AgentOverlay
            key="research"
            brandName={brandName}
            onComplete={handleResearchComplete}
            onBack={handleBackToSearch}
          />
        ) : (
          <BriefPlaceholder key="brief" brandName={brandName} />
        )}
      </AnimatePresence>
    </div>
  );
}
