import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageName } from '../checks.js';
import { ReviewDb, fingerprint, type CheckResult, type FindingInput, type RunInfo } from '../db.js';
import { evidenceState, parseEvidence, resolveEvidence } from '../evidence.js';

const run: RunInfo = { root: '/repo', headCommit: 'abc', dirty: false, snapshot: 's', analyzerVersion: 'test', stats: {} };
const finding = (subject: string): FindingInput => ({ check: 'file.cycle', title: `cycle ${subject}`, severity: 'warning', subjects: [subject], evidence: [{ file: 'a.ts', line: 1 }] });
const ok = (...findings: FindingInput[]): CheckResult[] => [{ check: 'file.cycle', ok: true, findings }];

describe('finding lifecycle', () => {
  it('keeps one identity across runs and records resolve and reopen', () => {
    const db = ReviewDb.open(':memory:');
    const a = fingerprint('file.cycle', ['a']);
    const b = fingerprint('file.cycle', ['b']);

    expect(db.recordScan(run, ok(finding('a'), finding('b'))).summary).toMatchObject({ new: 2, resolved: 0 });
    expect(db.recordScan(run, ok(finding('a'))).summary).toMatchObject({ new: 0, resolved: 1 });
    expect(db.finding(b)?.observation).toBe('absent');
    expect(db.recordScan(run, ok(finding('a'), finding('b'))).summary).toMatchObject({ new: 0, reopened: 1 });

    expect(db.finding(a)?.first_run).toBe(1);
    expect(db.finding(a)?.last_run).toBe(3);
    expect(db.eventsFor('finding', b).map((e) => e.type)).toEqual(['observed', 'resolved', 'reopened']);
    db.close();
  });

  it('retires, rather than resolves, findings that vanish because the check logic changed', () => {
    const db = ReviewDb.open(':memory:');
    db.recordScan({ ...run, analyzerVersion: 'checks/1 eyrie/a' }, ok(finding('a')));
    const { summary } = db.recordScan({ ...run, analyzerVersion: 'checks/2 eyrie/b' }, ok());
    expect(summary).toMatchObject({ resolved: 0, retired: 1 });
    expect(db.eventsFor('finding', fingerprint('file.cycle', ['a'])).map((e) => e.type)).toEqual(['observed', 'retired']);
    db.close();
  });

  it('marks findings unknown when their check fails, instead of resolving them', () => {
    const db = ReviewDb.open(':memory:');
    db.recordScan(run, ok(finding('a')));
    const { summary } = db.recordScan(run, [{ check: 'file.cycle', ok: false, error: 'boom', findings: [] }]);
    expect(summary).toMatchObject({ unknown: 1, resolved: 0 });
    expect(db.finding(fingerprint('file.cycle', ['a']))?.observation).toBe('unknown');
    db.close();
  });

  it('leaves findings of checks that did not run untouched', () => {
    const db = ReviewDb.open(':memory:');
    db.recordScan(run, ok(finding('a')));
    db.recordScan(run, [{ check: 'file.large', ok: true, findings: [] }]);
    expect(db.finding(fingerprint('file.cycle', ['a']))?.observation).toBe('present');
    db.close();
  });
});

describe('people and agents', () => {
  it('reserves triage and decisions for people, and requires evidence and reasons', () => {
    const db = ReviewDb.open(':memory:');
    db.recordScan(run, ok(finding('a')));
    const fp = fingerprint('file.cycle', ['a']);
    const ev = [{ file: 'a.ts', line: 1 }];

    expect(() => db.triage(fp, 'intended', 'why', 'claude-code:model')).toThrow(/person/);
    expect(() => db.triage(fp, 'intended', '', 'human:me')).toThrow(/reason/);
    expect(db.triage(fp, 'intended', 'deliberate', 'human:me').triage).toBe('intended');

    expect(() => db.addIssue({ title: 't', description: 'd', severity: 'warning', by: 'codex:model', evidence: [] })).toThrow(/evidence/);
    expect(() => db.addIssue({ title: 't', description: 'd', severity: 'warning', by: 'anonymous', evidence: ev })).toThrow(/Identify/);

    const p = db.addProposal({ target: `finding:${fp.slice(0, 6)}`, kind: 'fix', title: 't', body: 'b', by: 'codex:model', evidence: ev });
    expect(db.proposal(p)?.target).toBe(`finding:${fp}`);
    expect(() => db.addReview({ proposalId: p, verdict: 'agree', note: 'yes', by: 'codex:model', evidence: [] })).toThrow(/own/);
    db.addReview({ proposalId: p, verdict: 'agree', note: 'evidence holds', by: 'claude-code:model', evidence: [] });
    expect(() => db.decide(p, 'accepted', 'ok', 'codex:model')).toThrow(/person/);
    db.decide(p, 'accepted', 'ship it', 'human:me');
    expect(db.decisions()).toHaveLength(1);
    db.close();
  });
});

describe('evidence', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts only lines that exist inside the repository and detects when they change', () => {
    dir = mkdtempSync(join(tmpdir(), 'arch-review-'));
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\nthree\n');
    const ev = resolveEvidence(dir, parseEvidence('a.ts:2-3'));
    expect(ev).toMatchObject({ file: 'a.ts', line: 2, endLine: 3 });
    expect(() => resolveEvidence(dir, parseEvidence('a.ts:9'))).toThrow(/lines/);
    expect(() => resolveEvidence(dir, parseEvidence('../outside.ts:1'))).toThrow(/inside/);
    expect(() => resolveEvidence(dir, parseEvidence('missing.ts:1'))).toThrow(/does not exist/);
    expect(() => parseEvidence('a.ts')).toThrow(/path:line/);

    expect(evidenceState(dir, ev)).toBe('current');
    writeFileSync(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
    expect(evidenceState(dir, ev)).toBe('changed');
  });
});

describe('packageName', () => {
  it('maps import specifiers to package names', () => {
    expect(packageName('@eyrie/core')).toBe('@eyrie/core');
    expect(packageName('@xyflow/react/dist/style.css')).toBe('@xyflow/react');
    expect(packageName('three/examples/jsm/x')).toBe('three');
    expect(packageName('./local')).toBeNull();
    expect(packageName('node:fs')).toBeNull();
    expect(packageName('path')).toBeNull();
  });
});
