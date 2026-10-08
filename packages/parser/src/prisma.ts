import type { FileFacts, ModelFact } from '@eyrie/core';

const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported']);

/** Extracts `model X { ... }` blocks from a Prisma schema. */
export function extractPrisma(path: string, source: string, hash: string): FileFacts {
  const lines = source.split('\n');
  const enums = new Set([...source.matchAll(/^\s*enum\s+(\w+)/gm)].map((m) => m[1]!));
  const models: ModelFact[] = [];
  let current: ModelFact | null = null;
  lines.forEach((raw, i) => {
    const text = raw.replace(/\/\/.*$/, '').trim();
    const open = /^model\s+(\w+)\s*\{/.exec(text);
    if (open) {
      current = { name: open[1]!, line: i + 1, endLine: i + 1, fields: [], relations: [], orm: 'prisma' };
      return;
    }
    if (!current) return;
    if (text.startsWith('}')) {
      current.endLine = i + 1;
      models.push(current);
      current = null;
      return;
    }
    const field = /^(\w+)\s+(\w+)(\[\])?\??/.exec(text);
    if (field && !text.startsWith('@@')) {
      current.fields.push(field[1]!);
      const type = field[2]!;
      const isModel = !SCALARS.has(type) && !enums.has(type) && /^[A-Z]/.test(type);
      if (isModel && !current.relations.includes(type)) current.relations.push(type);
    }
  });
  return {
    path,
    language: 'prisma',
    hash,
    loc: lines.length,
    directives: [],
    imports: [],
    exports: [],
    symbols: [],
    references: [],
    routes: [],
    models,
    parseErrors: 0,
  };
}
