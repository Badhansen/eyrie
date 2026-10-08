import { NextResponse } from 'next/server';
import { requireCustomer } from '@/services/auth.service';
import { orderService } from '@/services/order.service';

export async function GET(request: Request) {
  const session = await requireCustomer(request);
  return NextResponse.json(await orderService.list(session.customerId));
}
