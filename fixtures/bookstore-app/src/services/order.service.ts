import { PaymentService } from './payment.service';
import { BackupPaymentService } from './backup-payment.service';
import { StoreCreditPaymentService } from './store-credit-payment.service';
import { PaymentRouterService } from './payment-router.service';
import { PaddlePaymentService } from './paddle-payment.service';
import { OrderRepository } from '@/repositories/order.repository';
import { buildOrderSummary } from '@/lib/summary';

/**
 * Turns a basket of books into a paid order.
 */
export class OrderService {
  private payments = new PaymentRouterService([
    new PaymentService(),
    new BackupPaymentService(),
    new PaddlePaymentService(),
    new StoreCreditPaymentService(),
  ]);

  constructor(private readonly repo: OrderRepository) {}

  async checkout(customerId: string, titles: string[], totalCents: number) {
    const summary = buildOrderSummary(titles, totalCents);
    const reference = await this.payments.charge(totalCents);
    return this.repo.save(customerId, summary, reference);
  }

  async list(customerId: string) {
    return this.repo.findByCustomer(customerId);
  }
}

export const orderService = new OrderService(new OrderRepository());
