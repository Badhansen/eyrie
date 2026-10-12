import { Database, GitBranch, ListOrdered, Map as MapIcon, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { ArchCategory } from '@eyrie/core';
import { matches } from '../graph/analysis';
import { useLensGraph } from '../graph/useLensGraph';
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../graph/vocabulary';
import { store, useStore, type ConnectionStatus, type Lens } from '../state/store';
import { ThemeToggle } from './ThemeToggle';

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
    <header className="eyrie-topbar">
      <div className="navbar-primary">
        <div className="navbar-identity">
          <span className="navbar-brand">Eyrie</span>
          <span className="navbar-divider" aria-hidden="true" />
          <GitBranch size={15} className="navbar-repo-icon" aria-hidden="true" />
          <h1 title={repo?.name}>{repo?.name ?? 'Connecting…'}</h1>
        </div>
        <LensSwitch />
        <div className="navbar-tools">
          <SearchBox />
          <ThemeToggle />
          <LiveStatus />
        </div>
      </div>
      <div className="navbar-context">
        <div className="navbar-repo-context">
          {repo?.frameworks.length ? <span className="navbar-frameworks">{repo.frameworks.join(' · ')}</span> : null}
          {stats ? (
            <dl className="navbar-stats">
              <Stat label="files" value={stats.files} />
              <Stat label="symbols" value={stats.symbols} />
              <Stat label="components" value={nodes.length} />
              <Stat label="links" value={edges.length} />
            </dl>
          ) : null}
        </div>
        <Filters present={present} />
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd>{value.toLocaleString()}</dd>
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
    <div role="radiogroup" aria-label="Lens" className="navbar-lenses">
      {LENS_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-label={o.label}
          aria-checked={lens === o.value}
          tabIndex={lens === o.value ? 0 : -1}
          title={`${o.hint} (${o.key})`}
          onClick={() => store.setLens(o.value)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = LENS_OPTIONS.findIndex((option) => option.value === lens);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? LENS_OPTIONS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + LENS_OPTIONS.length) % LENS_OPTIONS.length;
            store.setLens(LENS_OPTIONS[next]!.value);
            (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
          }}
          className="lens-option"
        >
          {o.icon}
          <span>{o.label}</span>
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
    <div className="navbar-search" data-searching={!!query}>
      <Search size={15} className="navbar-search-icon" aria-hidden="true" />
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
        className="search-field"
      />
      {query ? <span className="navbar-search-count" role="status">{results.length} found</span> : null}
      {query ? (
        <button type="button" aria-label="Clear search" title="Clear search" onClick={() => { store.setQuery(''); ref.current?.focus(); }} className="navbar-search-clear">
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

function Filters({ present }: { present: { cat: ArchCategory; count: number }[] }) {
  const hidden = useStore((s) => s.hidden);
  return (
    <div role="group" aria-label="Show categories" className="navbar-filters scroll-thin">
      {present.map(({ cat, count }) => {
        const on = !hidden.has(cat);
        return (
          <button
            key={cat}
            type="button"
            aria-pressed={on}
            onClick={() => store.toggleCategory(cat)}
            title={on ? `Hide ${CATEGORY_LABEL[cat]}` : `Show ${CATEGORY_LABEL[cat]}`}
            className={`cat-${cat} category-filter`}
          >
            <span className="category-swatch" aria-hidden="true" />
            {CATEGORY_LABEL[cat]}
            <span className="category-count">{count}</span>
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
    <div className="navbar-status" role="status" aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'live-dot' : ''}`} style={{ background: color }} />
      {STATUS_COPY[status]}
    </div>
  );
}
