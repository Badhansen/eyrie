import { NextResponse } from 'next/server';
import { webhookService } from '@/services/webhook.service';

/** Receives Stripe payment events. */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature') ?? '';
  const type = await webhookService.handleWebhook(await request.text(), signature);
  return NextResponse.json({ received: type });
}
