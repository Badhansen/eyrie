import { lemonSqueezy } from '@/lib/lemonsqueezy';

/**
 * Second payment gateway, used when Stripe declines the charge.
 */
export class BackupPaymentService {
  async charge(amountCents: number): Promise<string> {
    const checkout = await lemonSqueezy.createCheckout({
      storeId: process.env.LEMONSQUEEZY_STORE_ID ?? '',
      variantId: process.env.LEMONSQUEEZY_VARIANT_ID ?? '',
      totalCents: amountCents,
    });
    return checkout.id;
  }
}
