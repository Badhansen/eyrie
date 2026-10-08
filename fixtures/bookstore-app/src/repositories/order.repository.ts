import { prisma } from '@/lib/prisma';

/** Persistence for orders and their line items. */
export class OrderRepository {
  async findByCustomer(customerId: string) {
    return prisma.order.findMany({ where: { customerId } });
  }

  async findById(id: string) {
    return prisma.order.findUnique({ where: { id } });
  }

  async save(customerId: string, summary: string, reference: string) {
    const order = await prisma.order.create({ data: { customerId, summary, status: 'pending' } });
    await prisma.orderItem.create({ data: { orderId: order.id, bookId: reference, quantity: 1 } });
    return order;
  }
}
