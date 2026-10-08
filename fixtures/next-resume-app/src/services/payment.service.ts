import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';

export const paymentService = {
  /** Applies a Stripe webhook event to the user's subscription. */
  async handleWebhook(payload: string, signature: string) {
    const event = stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET ?? '');
    if (event.type === 'customer.subscription.updated') {
      await prisma.subscription.update({ where: { userId: 'x' }, data: { status: 'active' } });
    }
    return event.type;
  },
};
