import { FolderPlus, MoreHorizontal, RefreshCw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggle } from '../components/ThemeToggle';
import { desktop, type AddResult, type DesktopProjects, type ProjectView } from '../lib/desktop';
import { formatDuration, formatElapsed, plural, timeAgo } from './format';

/**
 * The desktop app's home: every project added to Eyrie, what its last scan
 * found, and its actions. The desktop app serves it as eyrie://app/projects.html;
 * in a browser there is no project list, so it says where to find one.
 */
export function ProjectsApp() {
  const api = desktop?.projects;
  return api ? <Projects api={api} /> : <NotDesktop />;
}

const BUSY = new Set<ProjectView['status']>(['queued', 'scanning', 'opening']);

function Projects({ api }: { api: DesktopProjects }) {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const off = api.onChange(setProjects);
    void api.list().then(setProjects);
    return off;
  }, [api]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea');
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const report = ({ skipped }: AddResult) => {
    if (skipped.length) setNotice(`${plural(skipped.length, 'item')} not added: not a folder, or already in the list.`);
  };
  const add = () => void api.add().then(report);
  const dropping = useFolderDrop((files) => void api.addFiles(files).then(report));

  const anyBusy = projects?.some((p) => BUSY.has(p.status)) ?? false;
  const now = useNow(anyBusy ? 1000 : 30_000);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q && projects ? projects.filter((p) => p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q)) : (projects ?? []);
  }, [projects, query]);

  const scannable = projects?.filter((p) => !p.missing && p.status === 'idle').length ?? 0;
  const hasProjects = !!projects?.length;

  return (
    <div className="projects-shell">
      <header className="eyrie-topbar">
        <div className="projects-bar">
          <div className="navbar-identity">
            <span className="navbar-brand">Eyrie</span>
            <span className="navbar-divider" aria-hidden="true" />
            <h1>Projects</h1>
          </div>
          <div className="projects-tools">
            {hasProjects ? (
              <div className="navbar-search" data-searching={!!query}>
                <Search size={15} className="navbar-search-icon" aria-hidden="true" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && shown[0] && !shown[0].missing) void api.open(shown[0].id);
                    if (e.key === 'Escape') {
                      setQuery('');
                      searchRef.current?.blur();
                    }
                  }}
                  placeholder="Find a project"
                  aria-label="Find a project"
                  className="search-field"
                />
                {query ? (
                  <span className="navbar-search-count" role="status">
                    {shown.length} found
                  </span>
                ) : null}
                {query ? (
                  <button type="button" aria-label="Clear search" title="Clear search" onClick={() => setQuery('')} className="navbar-search-clear">
                    <X size={13} />
                  </button>
                ) : null}
              </div>
            ) : null}
            <ThemeToggle />
            {hasProjects ? (
              <button type="button" className="btn" onClick={() => void api.scanAll()} disabled={!scannable} title="Scan every project that is not open or already scanning">
                <RefreshCw size={13} aria-hidden="true" />
                Scan all
              </button>
            ) : null}
            <button type="button" className="btn btn-primary" onClick={add}>
              <FolderPlus size={14} aria-hidden="true" />
              Add project
            </button>
          </div>
        </div>
        <div className="navbar-context">
          <p className="projects-summary">{projects ? <Summary projects={projects} /> : null}</p>
          <p className="projects-hint" role="status">
            {notice ?? (hasProjects ? 'Drop a folder anywhere to add it · double-click a project to open it · right-click for more' : null)}
          </p>
        </div>
      </header>

      <main className="projects-main">
        {!projects ? null : !hasProjects ? (
          <EmptyState onAdd={add} />
        ) : (
          <div className="projects-table" role="table" aria-label="Projects">
            <div className="projects-head" role="row">
              <span role="columnheader">Project</span>
              <span role="columnheader">Last index</span>
              <span role="columnheader">Scanned</span>
              <span role="columnheader">
                <span className="sr-only">Actions</span>
              </span>
            </div>
            {shown.map((project) => (
              <ProjectRow key={project.id} project={project} api={api} now={now} />
            ))}
            {!shown.length ? <p className="projects-nomatch">No projects match “{query.trim()}”.</p> : null}
          </div>
        )}
      </main>

      {dropping ? (
        <div className="projects-drop" aria-hidden="true">
          <div>
            <FolderPlus size={22} />
            Drop folders to add them
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ projects }: { projects: ProjectView[] }) {
  const count = (status: ProjectView['status']) => projects.filter((p) => p.status === status).length;
  const parts = [plural(projects.length, 'project')];
  if (count('live') || count('opening')) parts.push('1 open');
  if (count('scanning')) parts.push(`${count('scanning')} scanning`);
  if (count('queued')) parts.push(`${count('queued')} queued`);
  return <>{parts.join(' · ')}</>;
}

function ProjectRow({ project, api, now }: { project: ProjectView; api: DesktopProjects; now: number }) {
  const { id, status, missing } = project;
  const moreRef = useRef<HTMLButtonElement>(null);
  const isOpen = status === 'live' || status === 'opening';
  const scanning = status === 'scanning' || status === 'queued';

  const showMenu = (at?: { x: number; y: number }) => void api.menu(id, at);

  return (
    <div
      role="row"
      className="project-row"
      data-status={status}
      onContextMenu={(e) => {
        e.preventDefault();
        showMenu({ x: e.clientX, y: e.clientY });
      }}
      onDoubleClick={(e) => {
        if (!missing && !(e.target as HTMLElement).closest('button')) void api.open(id);
      }}
    >
      <div role="cell" className="project-identity">
        <div className="project-title">
          <h2 title={project.name}>{project.name}</h2>
          <Status project={project} now={now} />
        </div>
        <p className="project-path" title={project.root}>
          {project.displayRoot}
        </p>
        {project.error && !missing && !scanning ? (
          <p className="project-error" title={project.error}>
            {project.error}
          </p>
        ) : null}
      </div>

      <div role="cell" className="project-contents">
        {project.scan ? (
          <>
            <dl className="project-stats">
              <Stat label="files" value={project.scan.files} />
              <Stat label="symbols" value={project.scan.symbols} />
              <Stat label="components" value={project.scan.components} />
              <Stat label="links" value={project.scan.links} />
            </dl>
            {project.scan.frameworks.length ? <p className="project-frameworks">{project.scan.frameworks.join(' · ')}</p> : null}
            {project.scan.commits ? (
              <p className="project-history" title={project.ai ? `Commits are noted by ${project.ai}` : 'Turn on Analyse Commits with Claude in the ⋯ menu for notes on each commit'}>
                {plural(project.scan.commits, 'commit')}
                {project.ai ? ` · ${(project.scan.analysed ?? 0).toLocaleString()} noted by ${project.ai}` : ''}
              </p>
            ) : null}
          </>
        ) : (
          <p className="project-never">{status === 'queued' ? 'Waiting to scan…' : status === 'scanning' ? 'Scanning for the first time…' : 'Not scanned yet'}</p>
        )}
      </div>

      <div role="cell" className="project-when">
        {project.scan ? (
          <>
            <time dateTime={new Date(project.scan.at).toISOString()} title={new Date(project.scan.at).toLocaleString()}>
              {timeAgo(project.scan.at, now)}
            </time>
            <small>took {formatDuration(project.scan.ms)}</small>
          </>
        ) : (
          <span className="project-never">—</span>
        )}
      </div>

      <div role="cell" className="project-actions">
        <button
          type="button"
          className="btn btn-open"
          onClick={() => void api.open(id)}
          disabled={missing}
          title={isOpen ? 'Go back to this project’s map' : 'Index the project and open its live map'}
        >
          {isOpen ? 'Return' : 'Open'}
        </button>
        {missing ? (
          <button type="button" className="btn btn-quiet btn-slot" onClick={() => void api.remove(id)} title="Take this project off the list">
            Remove
          </button>
        ) : status === 'live' ? (
          <button type="button" className="btn btn-quiet btn-slot" onClick={() => void api.close(id)} title="Stop the live map; it stays in the list">
            Close
          </button>
        ) : scanning ? (
          <button type="button" className="btn btn-quiet btn-slot" onClick={() => void api.cancel(id)} title={status === 'queued' ? 'Take it out of the queue' : 'Stop this scan'}>
            {status === 'queued' ? 'Cancel' : 'Stop'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-quiet btn-slot"
            onClick={() => void api.scan(id)}
            disabled={status === 'opening'}
            title="Parse what changed since the last scan and refresh the cache"
          >
            Scan
          </button>
        )}
        <button
          ref={moreRef}
          type="button"
          className="btn btn-quiet btn-icon"
          aria-label={`More actions for ${project.name}`}
          title="More actions"
          onClick={() => {
            const box = moreRef.current?.getBoundingClientRect();
            showMenu(box ? { x: box.left, y: box.bottom + 4 } : undefined);
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {BUSY.has(status) ? <span className="project-progress" data-waiting={status === 'queued' || undefined} aria-hidden="true" /> : null}
    </div>
  );
}

/** A dot and a word for anything other than a quiet, healthy project: colour is never the only signal. */
function Status({ project, now }: { project: ProjectView; now: number }) {
  const { status, since } = project;
  const elapsed = since ? ` ${formatElapsed(since, now)}` : '';
  if (project.missing) return <Mark tone="fault">Folder not found</Mark>;
  if (status === 'live') return <Mark tone="live">Live</Mark>;
  if (status === 'opening') return <Mark tone="busy">Opening{elapsed}</Mark>;
  if (status === 'scanning') return <Mark tone="busy">Scanning{elapsed}</Mark>;
  if (status === 'queued') return <Mark tone="busy" hollow>Queued</Mark>;
  if (project.error) return <Mark tone="fault">Failed</Mark>;
  return null;
}

function Mark({ tone, hollow, children }: { tone: 'live' | 'busy' | 'fault'; hollow?: boolean; children: React.ReactNode }) {
  return (
    <span className="project-status" data-tone={tone} data-hollow={hollow || undefined}>
      <span className={tone === 'live' ? 'dot live-dot' : 'dot'} aria-hidden="true" />
      {children}
    </span>
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="projects-empty">
      <div>
        <p className="projects-eyebrow">No projects yet</p>
        <h2 className="wide">Add a repository to map</h2>
        <p className="projects-lede">Eyrie reads a repository on this machine, caches what it parsed, and opens a map of its architecture that stays in step as the code changes.</p>
        <ol className="projects-steps">
          <li>
            <span>01</span>
            <b>Add</b>a folder you have checked out
          </li>
          <li>
            <span>02</span>
            <b>Scan</b>parse it and see what it holds
          </li>
          <li>
            <span>03</span>
            <b>Open</b>explore its live architecture map
          </li>
        </ol>
        <div className="projects-empty-actions">
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <FolderPlus size={14} aria-hidden="true" />
            Add project
          </button>
          <span>or drop a folder onto this window</span>
        </div>
      </div>
    </div>
  );
}

function NotDesktop() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-md">
        <p className="font-mono text-[10px] tracking-[0.18em] text-faint uppercase">Eyrie</p>
        <h1 className="wide mt-2 text-[20px] font-[750]">Projects are part of the desktop app</h1>
        <p className="mt-3 text-[13.5px] leading-relaxed text-dim">
          This page lists the repositories added to Eyrie’s desktop app. In a browser, run <code className="rounded bg-ink-2 px-1 py-0.5 font-mono text-text">eyrie</code> in a
          project and use the link it prints; to use the desktop app, run <code className="rounded bg-ink-2 px-1 py-0.5 font-mono text-text">pnpm desktop</code>.
        </p>
      </div>
    </div>
  );
}

/** The current time, refreshed every `ms`. */
function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** Accepts folders dragged from the Finder or Explorer anywhere on the page; true while one is over it. */
function useFolderDrop(onDrop: (files: File[]) => void): boolean {
  const [over, setOver] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    let depth = 0;
    const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const hover = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      latest.current([...e.dataTransfer!.files]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', hover);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', hover);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}
