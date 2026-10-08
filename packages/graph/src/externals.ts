/**
 * Known third-party services, recognised by package name or API host.
 * Imports of these packages become `external_service` nodes so the
 * architecture graph can show "AI Service → OpenAI" without AI guessing.
 */

export type ExternalCategory =
  | 'ai'
  | 'database'
  | 'payments'
  | 'auth'
  | 'email'
  | 'storage'
  | 'queue'
  | 'analytics'
  | 'messaging'
  | 'search'
  | 'api';

export interface ExternalProvider {
  id: string;
  label: string;
  category: ExternalCategory;
}

const P = (id: string, label: string, category: ExternalCategory): ExternalProvider => ({ id, label, category });

const PROVIDERS = {
  openai: P('openai', 'OpenAI', 'ai'),
  anthropic: P('anthropic', 'Anthropic', 'ai'),
  gemini: P('gemini', 'Google Gemini', 'ai'),
  vercelAi: P('vercel-ai', 'Vercel AI SDK', 'ai'),
  langchain: P('langchain', 'LangChain', 'ai'),
  mistral: P('mistral', 'Mistral', 'ai'),
  cohere: P('cohere', 'Cohere', 'ai'),
  groq: P('groq', 'Groq', 'ai'),
  replicate: P('replicate', 'Replicate', 'ai'),
  ollama: P('ollama', 'Ollama', 'ai'),
  pinecone: P('pinecone', 'Pinecone', 'ai'),
  stripe: P('stripe', 'Stripe', 'payments'),
  lemonsqueezy: P('lemonsqueezy', 'Lemon Squeezy', 'payments'),
  paddle: P('paddle', 'Paddle', 'payments'),
  prisma: P('prisma', 'Prisma', 'database'),
  drizzle: P('drizzle', 'Drizzle ORM', 'database'),
  mongodb: P('mongodb', 'MongoDB', 'database'),
  postgres: P('postgres', 'PostgreSQL', 'database'),
  mysql: P('mysql', 'MySQL', 'database'),
  sqlite: P('sqlite', 'SQLite', 'database'),
  supabase: P('supabase', 'Supabase', 'database'),
  firebase: P('firebase', 'Firebase', 'database'),
  redis: P('redis', 'Redis', 'database'),
  convex: P('convex', 'Convex', 'database'),
  s3: P('aws-s3', 'AWS S3', 'storage'),
  aws: P('aws', 'AWS', 'api'),
  cloudinary: P('cloudinary', 'Cloudinary', 'storage'),
  uploadthing: P('uploadthing', 'UploadThing', 'storage'),
  resend: P('resend', 'Resend', 'email'),
  sendgrid: P('sendgrid', 'SendGrid', 'email'),
  smtp: P('smtp', 'SMTP (Nodemailer)', 'email'),
  postmark: P('postmark', 'Postmark', 'email'),
  twilio: P('twilio', 'Twilio', 'messaging'),
  slack: P('slack', 'Slack', 'messaging'),
  clerk: P('clerk', 'Clerk', 'auth'),
  nextAuth: P('nextauth', 'Auth.js', 'auth'),
  betterAuth: P('better-auth', 'Better Auth', 'auth'),
  auth0: P('auth0', 'Auth0', 'auth'),
  bullmq: P('bullmq', 'BullMQ', 'queue'),
  inngest: P('inngest', 'Inngest', 'queue'),
  trigger: P('trigger', 'Trigger.dev', 'queue'),
  sentry: P('sentry', 'Sentry', 'analytics'),
  posthog: P('posthog', 'PostHog', 'analytics'),
  algolia: P('algolia', 'Algolia', 'search'),
  github: P('github', 'GitHub API', 'api'),
  google: P('google-apis', 'Google APIs', 'api'),
} satisfies Record<string, ExternalProvider>;

const PACKAGES: Record<string, ExternalProvider> = {
  openai: PROVIDERS.openai,
  '@ai-sdk/openai': PROVIDERS.openai,
  '@anthropic-ai/sdk': PROVIDERS.anthropic,
  '@ai-sdk/anthropic': PROVIDERS.anthropic,
  '@google/generative-ai': PROVIDERS.gemini,
  '@google/genai': PROVIDERS.gemini,
  '@ai-sdk/google': PROVIDERS.gemini,
  ai: PROVIDERS.vercelAi,
  langchain: PROVIDERS.langchain,
  '@mistralai/mistralai': PROVIDERS.mistral,
  'cohere-ai': PROVIDERS.cohere,
  'groq-sdk': PROVIDERS.groq,
  replicate: PROVIDERS.replicate,
  ollama: PROVIDERS.ollama,
  '@pinecone-database/pinecone': PROVIDERS.pinecone,
  stripe: PROVIDERS.stripe,
  '@stripe/stripe-js': PROVIDERS.stripe,
  '@lemonsqueezy/lemonsqueezy.js': PROVIDERS.lemonsqueezy,
  '@paddle/paddle-node-sdk': PROVIDERS.paddle,
  '@prisma/client': PROVIDERS.prisma,
  'drizzle-orm': PROVIDERS.drizzle,
  mongoose: PROVIDERS.mongodb,
  mongodb: PROVIDERS.mongodb,
  pg: PROVIDERS.postgres,
  postgres: PROVIDERS.postgres,
  '@neondatabase/serverless': PROVIDERS.postgres,
  '@vercel/postgres': PROVIDERS.postgres,
  mysql2: PROVIDERS.mysql,
  'better-sqlite3': PROVIDERS.sqlite,
  '@libsql/client': PROVIDERS.sqlite,
  '@supabase/supabase-js': PROVIDERS.supabase,
  '@supabase/ssr': PROVIDERS.supabase,
  firebase: PROVIDERS.firebase,
  'firebase-admin': PROVIDERS.firebase,
  redis: PROVIDERS.redis,
  ioredis: PROVIDERS.redis,
  '@upstash/redis': PROVIDERS.redis,
  convex: PROVIDERS.convex,
  '@aws-sdk/client-s3': PROVIDERS.s3,
  cloudinary: PROVIDERS.cloudinary,
  uploadthing: PROVIDERS.uploadthing,
  resend: PROVIDERS.resend,
  '@sendgrid/mail': PROVIDERS.sendgrid,
  nodemailer: PROVIDERS.smtp,
  postmark: PROVIDERS.postmark,
  twilio: PROVIDERS.twilio,
  '@slack/web-api': PROVIDERS.slack,
  '@clerk/nextjs': PROVIDERS.clerk,
  '@clerk/clerk-sdk-node': PROVIDERS.clerk,
  'next-auth': PROVIDERS.nextAuth,
  '@auth/core': PROVIDERS.nextAuth,
  'better-auth': PROVIDERS.betterAuth,
  '@auth0/nextjs-auth0': PROVIDERS.auth0,
  bullmq: PROVIDERS.bullmq,
  bull: PROVIDERS.bullmq,
  inngest: PROVIDERS.inngest,
  '@trigger.dev/sdk': PROVIDERS.trigger,
  '@sentry/nextjs': PROVIDERS.sentry,
  '@sentry/node': PROVIDERS.sentry,
  'posthog-js': PROVIDERS.posthog,
  'posthog-node': PROVIDERS.posthog,
  algoliasearch: PROVIDERS.algolia,
  octokit: PROVIDERS.github,
  '@octokit/rest': PROVIDERS.github,
  googleapis: PROVIDERS.google,
};

const HOSTS: Record<string, ExternalProvider> = {
  'api.openai.com': PROVIDERS.openai,
  'api.anthropic.com': PROVIDERS.anthropic,
  'generativelanguage.googleapis.com': PROVIDERS.gemini,
  'api.stripe.com': PROVIDERS.stripe,
  'api.github.com': PROVIDERS.github,
  'hooks.slack.com': PROVIDERS.slack,
  'slack.com': PROVIDERS.slack,
  'api.resend.com': PROVIDERS.resend,
  'api.sendgrid.com': PROVIDERS.sendgrid,
  'api.twilio.com': PROVIDERS.twilio,
};

/** `@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`. */
export function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

export function providerForPackage(specifier: string): ExternalProvider | null {
  const name = packageName(specifier);
  if (PACKAGES[name]) return PACKAGES[name]!;
  if (name.startsWith('@langchain/')) return PROVIDERS.langchain;
  if (name.startsWith('@aws-sdk/')) return PROVIDERS.aws;
  return null;
}

export function providerForUrl(url: string): ExternalProvider | null {
  if (/^https?:\/\/:param/.test(url)) return null;
  let host: string;
  try {
    // Template placeholders follow the host (`${base}/path`) or form it (`https://${host}`).
    host = new URL(url.replace(/:param/g, '')).hostname;
  } catch {
    return null;
  }
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  return HOSTS[host] ?? { id: `host:${host}`, label: host, category: 'api' };
}
