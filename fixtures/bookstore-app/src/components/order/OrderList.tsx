'use client';
import Link from 'next/link';
import { useOrders } from '@/hooks/useOrders';

export function OrderList() {
  const orders = useOrders();
  return (
    <ul>
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/order/${o.id}`}>{o.summary}</Link>
        </li>
      ))}
    </ul>
  );
}
