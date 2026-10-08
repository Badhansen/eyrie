import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';

export const webhookService = {
  /** Applies a Stripe webhook event to the order's payment record. */
  async handleWebhook(payload: string, signature: string) {
    const event = stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET ?? '');
    if (event.type === 'payment_intent.succeeded') {
      await prisma.payment.update({ where: { orderId: 'x' }, data: { status: 'paid' } });
    }
    return event.type;
  },
};
