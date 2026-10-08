import { prisma } from '@/lib/prisma';

export interface Session {
  userId: string;
  email: string;
}

/** Resolves the signed-in user from the session cookie. */
export async function getSession(request: Request): Promise<Session | null> {
  const token = request.headers.get('cookie')?.match(/session=([^;]+)/)?.[1];
  if (!token) return null;
  const user = await prisma.user.findUnique({ where: { id: token } });
  return user ? { userId: user.id, email: user.email } : null;
}

export async function requireUser(request: Request): Promise<Session> {
  const session = await getSession(request);
  if (!session) throw new Error('Unauthorized');
  return session;
}
