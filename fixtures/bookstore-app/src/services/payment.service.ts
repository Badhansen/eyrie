import { stripe } from '@/lib/stripe';

/**
 * Wraps the payment provider so the rest of the app never talks to Stripe directly.
 */
export class PaymentService {
  async charge(amountCents: number): Promise<string> {
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
    });
    return parseReference(intent.id);
  }
}

function parseReference(id: string): string {
  return id.trim();
}
