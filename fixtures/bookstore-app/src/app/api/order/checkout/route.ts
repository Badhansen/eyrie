import { NextResponse } from 'next/server';
import { requireCustomer } from '@/services/auth.service';
import { orderService } from '@/services/order.service';

/** Charges the basket and records the order. */
export async function POST(request: Request) {
  const session = await requireCustomer(request);
  const { titles, totalCents } = await request.json();
  const order = await orderService.checkout(session.customerId, titles, totalCents);
  return NextResponse.json(order);
}
