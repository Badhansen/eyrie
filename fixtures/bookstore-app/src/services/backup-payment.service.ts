import { lemonSqueezy } from '@/lib/lemonsqueezy';
import type { PaymentStrategy } from './payment-strategy';

/**
 * Second payment gateway, used when Stripe declines the charge.
 */
export class BackupPaymentService implements PaymentStrategy {
  async charge(amountCents: number): Promise<string> {
    const checkout = await lemonSqueezy.createCheckout({
      storeId: process.env.LEMONSQUEEZY_STORE_ID ?? '',
      variantId: process.env.LEMONSQUEEZY_VARIANT_ID ?? '',
      totalCents: amountCents,
    });
    return checkout.id;
  }
}
