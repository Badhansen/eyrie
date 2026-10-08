'use client';
import { useEffect, useState } from 'react';

export default function OrderViewer({ id }: { id: string }) {
  const [order, setOrder] = useState<unknown>(null);
  useEffect(() => {
    fetch(`/api/order/${id}`).then((r) => r.json()).then(setOrder);
  }, [id]);
  return <pre>{JSON.stringify(order, null, 2)}</pre>;
}
