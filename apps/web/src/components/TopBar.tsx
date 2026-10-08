import { Database, ListOrdered, Map as MapIcon, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { ArchCategory } from '@eyrie/core';
import { matches } from '../graph/analysis';
import { useLensGraph } from '../graph/useLensGraph';
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../graph/vocabulary';
import { store, useStore, type ConnectionStatus, type Lens } from '../state/store';

export function TopBar() {
  const repo = useStore((s) => s.repo);
  const stats = useStore((s) => s.stats);
  const { nodes, edges } = useLensGraph();

  const present = useMemo(() => {
    const counts = new Map<ArchCategory, number>();
    for (const n of nodes) counts.set(n.category, (counts.get(n.category) ?? 0) + 1);
    return CATEGORY_ORDER.filter((c) => counts.has(c)).map((c) => ({ cat: c, count: counts.get(c)! }));
  }, [nodes]);

  return (
    <header className="flex min-h-12 flex-wrap items-center gap-x-5 gap-y-2 border-b border-rule bg-ink-1 px-4 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:flex-none">
        <span className="font-mono text-[10px] tracking-[0.18em] text-faint uppercase">Eyrie</span>
        <h1 className="wide min-w-0 truncate text-[15px] font-[750] tracking-tight">{repo?.name ?? 'Connecting…'}</h1>
        {repo?.frameworks.length ? <span className="hidden font-mono text-[11px] text-faint md:inline">{repo.frameworks.join(' · ')}</span> : null}
        <span className="ml-auto sm:hidden">
          <LiveStatus />
        </span>
      </div>

      {stats ? (
        <dl className="hidden items-baseline gap-4 font-mono text-[11px] text-dim lg:flex">
          <Stat label="files" value={stats.files} />
          <Stat label="symbols" value={stats.symbols} />
          <Stat label="components" value={nodes.length} />
          <Stat label="links" value={edges.length} />
        </dl>
      ) : null}

      <div className="flex w-full min-w-0 flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:items-center sm:gap-3">
        <LensSwitch />
        <SearchBox />
        <Filters present={present} />
        <span className="hidden sm:block">
          <LiveStatus />
        </span>
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="text-text tabular-nums">{value.toLocaleString()}</dd>
      <dt>{label}</dt>
    </div>
  );
}

const LENS_OPTIONS: { value: Lens; label: string; icon: React.ReactNode; hint: string; key: string }[] = [
  { value: 'architecture', label: 'Architecture', icon: <MapIcon size={13} />, hint: 'What the system is made of', key: '1' },
  { value: 'dataflow', label: 'Data flow', icon: <Database size={13} />, hint: 'Where data is read, written and sent over the network', key: '2' },
  { value: 'sequence', label: 'Sequence', icon: <ListOrdered size={13} />, hint: 'What one request does, step by step', key: '3' },
];

function LensSwitch() {
  const lens = useStore((s) => s.lens);
  return (
    <div role="radiogroup" aria-label="Lens" className="flex shrink-0 overflow-hidden rounded-md border border-rule bg-ink-0 p-0.5">
      {LENS_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={lens === o.value}
          title={`${o.hint} (${o.key})`}
          onClick={() => store.setLens(o.value)}
          className={`flex h-7 items-center gap-1.5 rounded px-2.5 text-[11.5px] whitespace-nowrap transition-colors ${lens === o.value ? 'bg-ink-3 text-text' : 'text-dim hover:text-text'}`}
        >
          {o.icon}
          <span className="hidden lg:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function SearchBox() {
  const query = useStore((s) => s.query);
  const nodes = useStore((s) => s.nodes);
  const ref = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (query.trim() ? [...nodes.values()].filter((n) => matches(n, query)) : []), [query, nodes]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative flex items-center">
      <Search size={13} className="pointer-events-none absolute left-2.5 text-faint" />
      <input
        ref={ref}
        value={query}
        onChange={(e) => store.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            store.select(results[0].id, true);
            ref.current?.blur();
          }
          if (e.key === 'Escape') {
            store.setQuery('');
            ref.current?.blur();
          }
        }}
        placeholder="Find a component or file"
        aria-label="Search components"
        className="h-8 w-full rounded-md border sm:w-72 border-rule bg-ink-0 pr-24 pl-8 text-[12.5px] text-text placeholder:text-faint focus:border-rule-strong focus:outline-none"
      />
      <span className={`pointer-events-none absolute font-mono text-[10px] text-faint ${query ? 'right-8' : 'right-2'}`}>
        {query ? (
          `${results.length} found`
        ) : (
          <kbd className="rounded border border-rule px-1 py-px">⌘K</kbd>
        )}
      </span>
      {query ? (
        <button type="button" aria-label="Clear search" onClick={() => store.setQuery('')} className="absolute right-1.5 grid h-6 w-6 place-items-center rounded text-faint hover:bg-ink-3 hover:text-text">
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

function Filters({ present }: { present: { cat: ArchCategory; count: number }[] }) {
  const hidden = useStore((s) => s.hidden);
  return (
    <div role="group" aria-label="Show categories" className="scroll-thin -mx-4 flex items-center gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
      {present.map(({ cat, count }) => {
        const on = !hidden.has(cat);
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={on}
            onClick={() => store.toggleCategory(cat)}
            title={on ? `Hide ${CATEGORY_LABEL[cat]}` : `Show ${CATEGORY_LABEL[cat]}`}
            className={`cat-${cat} flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors ${
              on ? 'border-rule bg-ink-2 text-text hover:border-rule-strong' : 'border-dashed border-rule text-faint hover:text-dim'
            }`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: on ? 'var(--c)' : 'transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--c)' }} />
            {CATEGORY_LABEL[cat]}
            <span className="font-mono text-[10px] text-faint">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

const STATUS_COPY: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  reconnecting: 'Reconnecting',
  unauthorized: 'No access',
};

function LiveStatus() {
  const status = useStore((s) => s.status);
  const color = status === 'live' ? 'var(--color-new)' : status === 'unauthorized' ? 'var(--color-removed)' : 'var(--color-modified)';
  return (
    <div className="flex items-center gap-2 rounded-full border border-rule px-2.5 py-1 font-mono text-[11px] text-dim" role="status" aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'live-dot' : ''}`} style={{ background: color }} />
      {STATUS_COPY[status]}
    </div>
  );
}
