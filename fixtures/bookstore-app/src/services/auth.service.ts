import { prisma } from '@/lib/prisma';

export interface Session {
  customerId: string;
  email: string;
}

/** Resolves the signed-in customer from the session cookie. */
export async function getSession(request: Request): Promise<Session | null> {
  const token = request.headers.get('cookie')?.match(/session=([^;]+)/)?.[1];
  if (!token) return null;
  const customer = await prisma.customer.findUnique({ where: { id: token } });
  return customer ? { customerId: customer.id, email: customer.email } : null;
}

export async function requireCustomer(request: Request): Promise<Session> {
  const session = await getSession(request);
  if (!session) throw new Error('Unauthorized');
  return session;
}
