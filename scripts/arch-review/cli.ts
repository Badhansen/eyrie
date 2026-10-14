import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GraphEngine } from '../../packages/engine/src/index.js';
import { CHECKS_VERSION, runChecks } from './checks.js';
import { ReviewDb } from './db.js';
import { evidenceState, formatEvidence, parseEvidence, resolveEvidence } from './evidence.js';
import { renderReport } from './report.js';

const USAGE = `Architecture review: deterministic checks plus a shared record of issues, proposals and decisions.

  pnpm arch scan [--baseline]                       Index the repo, run every check, record the results
  pnpm arch report [--out <file>]                   Markdown report of the latest scan and everything added since
  pnpm arch list [findings|issues|proposals] [--all]
  pnpm arch show <fingerprint | issue:<id> | proposal:<id>>

  pnpm arch issue --title <t> --description <d> --severity error|warning|info --by <tool>:<model> --evidence <path:line> [...]
  pnpm arch propose --target finding:<fp>|issue:<id>|architecture --kind fix|refactor|exception|rule|architecture
                    --title <t> (--body <b> | --body-file <f>) --by <tool>:<model> --evidence <path:line> [...]
  pnpm arch review <proposal-id> --verdict agree|disagree|needs-evidence --note <why> --by <tool>:<model> [--evidence ...]

  People only (--by human:<name>):
  pnpm arch triage <fingerprint> --verdict confirmed|intended|mapping-wrong|detector-wrong --note <why>
  pnpm arch issue-status <id> --status open|confirmed|rejected|fixed [--note <why>]
  pnpm arch decide <proposal-id> --status accepted|rejected|superseded --note <why>

Options: --root <repo> (default: current directory), --db <file> (default: <root>/.eyrie/knowledge.db).`;

const TOOL_ROOT = resolve(import.meta.dirname, '../..');

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      db: { type: 'string' },
      baseline: { type: 'boolean' },
      out: { type: 'string' },
      all: { type: 'boolean' },
      title: { type: 'string' },
      description: { type: 'string' },
      severity: { type: 'string' },
      by: { type: 'string' },
      evidence: { type: 'string', multiple: true },
      target: { type: 'string' },
      kind: { type: 'string' },
      body: { type: 'string' },
      'body-file': { type: 'string' },
      verdict: { type: 'string' },
      note: { type: 'string' },
      status: { type: 'string' },
    },
  });
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }
  const root = resolve(values.root ?? process.cwd());
  const db = ReviewDb.open(values.db ? resolve(values.db) : join(root, '.eyrie', 'knowledge.db'));
  const evidence = () => (values.evidence ?? []).map((arg) => resolveEvidence(root, parseEvidence(arg)));
  try {
    switch (command) {
      case 'scan': {
        const engine = new GraphEngine({ root, watch: false, dataDir: join(root, '.eyrie', 'review-cache') });
        await engine.start();
        const scan = runChecks(engine, root);
        await engine.stop();
        const tool = git(TOOL_ROOT, ['rev-parse', '--short', 'HEAD']);
        const { runId, summary } = db.recordScan(
          {
            root,
            headCommit: git(root, ['rev-parse', 'HEAD']),
            dirty: (git(root, ['status', '--porcelain']) ?? '') !== '',
            snapshot: scan.snapshot,
            analyzerVersion: `checks/${CHECKS_VERSION} eyrie/${tool ?? 'unknown'}`,
            stats: scan.stats,
          },
          scan.results,
          { baseline: values.baseline },
        );
        const failed = scan.results.filter((r) => !r.ok);
        console.log(
          `Run ${runId}: ${summary.observed} findings present (${summary.new} new, ${summary.reopened} reopened), ${summary.resolved} resolved, ` +
            `${summary.retired} retired by a check change, ${summary.unknown} unknown. ${scan.stats.files} files checked.`,
        );
        for (const r of failed) console.log(`  check ${r.check} failed: ${r.error}`);
        break;
      }
      case 'report': {
        const md = renderReport(db, root);
        if (values.out) {
          mkdirSync(dirname(resolve(values.out)), { recursive: true });
          writeFileSync(resolve(values.out), md);
          console.log(`Wrote ${values.out}`);
        } else console.log(md);
        break;
      }
      case 'list': {
        const what = positionals[0] ?? 'findings';
        if (what === 'findings') {
          for (const f of values.all ? db.findings() : db.findings('present')) console.log(`${f.fingerprint.slice(0, 8)}  ${f.severity.padEnd(7)}  ${f.observation.padEnd(7)}  ${f.triage.padEnd(14)}  ${f.title}`);
        } else if (what === 'issues') {
          for (const i of db.issues()) console.log(`issue:${i.id}  ${i.severity.padEnd(7)}  ${i.status.padEnd(9)}  ${i.reporter}  ${i.title}`);
        } else if (what === 'proposals') {
          for (const p of db.proposals()) console.log(`proposal:${p.id}  ${p.kind.padEnd(12)}  ${p.status.padEnd(9)}  ${p.author}  ${p.title}  (${db.reviews(p.id).length} reviews)`);
        } else throw new Error(`Unknown list "${what}".`);
        break;
      }
      case 'show': {
        const ref = positionals[0];
        if (!ref) throw new Error('show needs a fingerprint, issue:<id> or proposal:<id>.');
        const printEvidence = (items: { file: string; line: number; endLine?: number; sha?: string; note?: string }[]) => {
          for (const ev of items) console.log(`  ${formatEvidence(ev)}${ev.note ? `  (${ev.note})` : ''}  [${evidenceState(root, ev)}]`);
        };
        if (ref.startsWith('issue:')) {
          const i = db.issue(Number(ref.slice(6)));
          if (!i) throw new Error(`No ${ref}.`);
          console.log(`${ref}  ${i.severity}  ${i.status}  by ${i.reporter}\n${i.title}\n\n${i.description}\n\nEvidence:`);
          printEvidence(JSON.parse(i.evidence));
        } else if (ref.startsWith('proposal:')) {
          const p = db.proposal(Number(ref.slice(9)));
          if (!p) throw new Error(`No ${ref}.`);
          console.log(`${ref}  ${p.kind}  ${p.status}  for ${p.target}  by ${p.author}\n${p.title}\n\n${p.body}\n\nEvidence:`);
          printEvidence(JSON.parse(p.evidence));
          for (const r of db.reviews(p.id)) console.log(`Review ${r.verdict} by ${r.reviewer}: ${r.note}`);
        } else {
          const f = db.finding(ref);
          if (!f) throw new Error(`No finding ${ref}.`);
          console.log(`${f.fingerprint}  ${f.check_id}  ${f.severity}  ${f.observation}  ${f.triage}${f.baseline ? '  baseline' : ''}\n${f.title}`);
          const obs = db.latestObservation(f.fingerprint);
          if (obs) {
            console.log('Evidence (last observation):');
            printEvidence(obs.evidence);
            if (obs.detail) console.log(`Detail: ${JSON.stringify(obs.detail)}`);
          }
          console.log('History:');
          for (const e of db.eventsFor('finding', f.fingerprint)) console.log(`  ${new Date(e.at).toISOString()}  ${e.type}  by ${e.actor}${e.detail ? `  ${e.detail}` : ''}`);
        }
        break;
      }
      case 'issue': {
        const id = db.addIssue({ title: values.title, description: values.description, severity: values.severity, by: values.by, evidence: evidence() });
        console.log(`Recorded issue:${id}`);
        break;
      }
      case 'propose': {
        const body = values['body-file'] ? readFileSync(resolve(values['body-file']), 'utf8') : values.body;
        const id = db.addProposal({ target: values.target, kind: values.kind, title: values.title, body, by: values.by, evidence: evidence() });
        console.log(`Recorded proposal:${id}`);
        break;
      }
      case 'review': {
        const id = db.addReview({ proposalId: Number(positionals[0]), verdict: values.verdict, note: values.note, by: values.by, evidence: evidence() });
        console.log(`Recorded review ${id} on proposal:${positionals[0]}`);
        break;
      }
      case 'triage': {
        const f = db.triage(positionals[0] ?? '', values.verdict, values.note, values.by);
        console.log(`${f.fingerprint.slice(0, 8)} is now ${f.triage}`);
        break;
      }
      case 'issue-status':
        db.setIssueStatus(Number(positionals[0]), values.status, values.note, values.by);
        console.log(`issue:${positionals[0]} is now ${values.status}`);
        break;
      case 'decide':
        db.decide(Number(positionals[0]), values.status, values.note, values.by);
        console.log(`proposal:${positionals[0]} is now ${values.status}`);
        break;
      default:
        throw new Error(`Unknown command "${command}". Run \`pnpm arch help\`.`);
    }
  } finally {
    db.close();
  }
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
