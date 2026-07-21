import { useEffect, useState } from 'react';
import type {
  AgentName,
  AgentStatus,
  CampaignBrief,
  SseEvent,
} from '@atlas/shared';

export const AGENT_ORDER: AgentName[] = [
  'Discovery',
  'Financials',
  'Footprint',
  'Campaign',
  'Competitor',
  'Geo',
  'Strategy',
];

export const STATUS_COPY: Record<AgentName, string> = {
  Discovery: 'Discovering brand…',
  Financials: 'Analyzing financials…',
  Footprint: 'Mapping stores…',
  Campaign: 'Scanning campaigns…',
  Competitor: 'Identifying competitors…',
  Geo: 'Computing geo clusters…',
  Strategy: 'Synthesizing strategy…',
};

export type AgentCardState = {
  status: AgentStatus;
  detail?: string;
};

function initialAgents(): Record<AgentName, AgentCardState> {
  return Object.fromEntries(
    AGENT_ORDER.map((name) => [name, { status: 'pending' as const }]),
  ) as Record<AgentName, AgentCardState>;
}

type UseResearchStreamResult = {
  agents: Record<AgentName, AgentCardState>;
  statusText: string;
  /** True only when a validated CampaignBrief was received. */
  succeeded: boolean;
  error: string | null;
  brief: CampaignBrief | null;
  displayBrand: string;
};

export function useResearchStream(
  brandName: string,
  enabled: boolean,
): UseResearchStreamResult {
  const [agents, setAgents] = useState(initialAgents);
  const [statusText, setStatusText] = useState('Discovering brand…');
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<CampaignBrief | null>(null);
  const [displayBrand, setDisplayBrand] = useState(brandName);

  useEffect(() => {
    if (!enabled || !brandName) return;

    let cancelled = false;
    let gotMessage = false;

    setAgents(initialAgents());
    setStatusText('Discovering brand…');
    setSucceeded(false);
    setError(null);
    setBrief(null);
    setDisplayBrand(brandName);

    const url = `/api/research/stream?brand=${encodeURIComponent(brandName)}`;
    const source = new EventSource(url);

    source.onmessage = (message) => {
      if (cancelled) return;
      gotMessage = true;

      let event: SseEvent;
      try {
        event = JSON.parse(message.data) as SseEvent;
      } catch {
        return;
      }

      if (event.type === 'agent') {
        setAgents((prev) => ({
          ...prev,
          [event.agent]: {
            status: event.status,
            detail:
              event.status === 'done' || event.status === 'failed'
                ? event.detail
                : prev[event.agent]?.detail,
          },
        }));

        if (event.status === 'running') {
          setStatusText(STATUS_COPY[event.agent]);
        }

        // Surface canonical name from Discovery payload when available
        if (
          event.agent === 'Discovery' &&
          event.status === 'done' &&
          event.data &&
          typeof event.data === 'object'
        ) {
          const data = event.data as {
            officialName?: { value?: string | null };
          };
          const official = data.officialName?.value;
          if (official) setDisplayBrand(official);
        }
        return;
      }

      if (event.type === 'complete') {
        setBrief(event.brief);
        const name = event.brief.brand.name.value;
        if (name) setDisplayBrand(name);
        setSucceeded(true);
        setStatusText('Research complete');
        if (typeof window !== 'undefined') {
          (window as unknown as { __ATLAS_BRIEF__?: unknown }).__ATLAS_BRIEF__ =
            event.brief;
        }
        source.close();
        return;
      }

      if (event.type === 'error') {
        setError(event.message);
        setSucceeded(false);
        setStatusText('Research failed');
        source.close();
      }
    };

    source.onerror = () => {
      if (cancelled) return;
      if (!gotMessage && source.readyState === EventSource.CLOSED) {
        setError('Connection lost');
        setStatusText('Research failed');
      }
      source.close();
    };

    return () => {
      cancelled = true;
      source.close();
    };
  }, [brandName, enabled]);

  return { agents, statusText, succeeded, error, brief, displayBrand };
}
