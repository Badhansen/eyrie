import type { PaymentStrategy } from './payment-strategy';

/** Runs payment strategies in priority order, falling back when one rejects. */
export class PaymentRouterService implements PaymentStrategy {
  constructor(private readonly strategies: readonly PaymentStrategy[]) {}

  async charge(amountCents: number): Promise<string> {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error('Payment amount must be a positive integer');
    }
    const errors: unknown[] = [];
    for (const strategy of this.strategies) {
      try {
        return await strategy.charge(amountCents);
      } catch (error) {
        errors.push(error);
      }
    }
    throw new AggregateError(errors, 'All payment strategies failed');
  }
}
