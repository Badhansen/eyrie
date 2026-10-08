import { NextResponse } from 'next/server';
import { requireCustomer } from '@/services/auth.service';
import { OrderRepository } from '@/repositories/order.repository';

const repo = new OrderRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireCustomer(request);
  const { id } = await params;
  return NextResponse.json(await repo.findById(id));
}
