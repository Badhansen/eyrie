import dynamic from 'next/dynamic';

const OrderViewer = dynamic(() => import('@/components/order/OrderViewer'));

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderViewer id={id} />;
}
