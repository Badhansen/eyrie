import { NextResponse } from 'next/server';
import { paymentService } from '@/services/payment.service';

/** Receives Stripe subscription events. */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature') ?? '';
  const type = await paymentService.handleWebhook(await request.text(), signature);
  return NextResponse.json({ received: type });
}
