/** Strategy pattern: checkout accepts any payment provider with this contract. */
export interface PaymentStrategy {
  charge(amountCents: number): Promise<string>;
}
