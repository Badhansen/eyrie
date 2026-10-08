'use client';
import { useEffect, useState } from 'react';

export function useOrders() {
  const [orders, setOrders] = useState<{ id: string; summary: string }[]>([]);
  useEffect(() => {
    fetch('/api/order').then((r) => r.json()).then(setOrders);
  }, []);
  return orders;
}
