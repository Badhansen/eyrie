'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

/** Lets the customer search the catalog and check out the books they picked. */
export function BookBrowser({ customerId }: { customerId: string }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');

  async function checkout() {
    const res = await fetch('/api/order/checkout', {
      method: 'POST',
      body: JSON.stringify({ customerId, titles: [query], totalCents: 1200 }),
    });
    setResult(JSON.stringify(await res.json()));
  }

  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <Button onClick={checkout}>Check out</Button>
      <pre>{result}</pre>
    </div>
  );
}
