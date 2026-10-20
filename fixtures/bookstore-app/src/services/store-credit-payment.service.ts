import type { PaymentStrategy } from './payment-strategy';

/** Demo payment strategy with a per-instance store-credit balance, in cents. */
export class StoreCreditPaymentService implements PaymentStrategy {
  constructor(private balanceCents = 10_000) {
    if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
      throw new Error('Store credit must be a non-negative integer');
    }
  }

  async charge(amountCents: number): Promise<string> {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error('Payment amount must be a positive integer');
    }
    if (amountCents > this.balanceCents) {
      throw new Error('Insufficient store credit');
    }
    this.balanceCents -= amountCents;
    return `store-credit:${crypto.randomUUID()}`;
  }
}
