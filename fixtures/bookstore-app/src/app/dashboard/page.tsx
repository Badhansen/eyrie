import { BookBrowser } from '@/components/book/BookBrowser';
import { OrderList } from '@/components/order/OrderList';

export default function DashboardPage() {
  return (
    <main>
      <OrderList />
      <BookBrowser customerId="" />
    </main>
  );
}
