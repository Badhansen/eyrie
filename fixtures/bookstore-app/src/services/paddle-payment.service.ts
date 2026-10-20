import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import type { PaymentStrategy } from './payment-strategy';

/** Strategy/Adapter: translates bookstore amounts into Paddle sandbox checkouts.
 * A transaction reference represents checkout creation, not confirmed payment.
 */
export class PaddlePaymentService implements PaymentStrategy {
  async charge(amountCents: number): Promise<string> {
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new Error('Payment amount must be a positive integer');
    }
    const apiKey = process.env.PADDLE_API_KEY;
    const productId = process.env.PADDLE_PRODUCT_ID;
    if (!apiKey || !productId) throw new Error('Paddle sandbox is not configured');

    const paddle = new Paddle(apiKey, { environment: Environment.sandbox });
    const transaction = await paddle.transactions.create({
      items: [{
        quantity: 1,
        price: {
          description: 'Bookstore basket',
          productId,
          unitPrice: { amount: String(amountCents), currencyCode: 'USD' },
        },
      }],
    });
    return transaction.id;
  }
}
