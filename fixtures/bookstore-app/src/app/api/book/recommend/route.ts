import { NextResponse } from 'next/server';
import { requireCustomer } from '@/services/auth.service';
import { recommenderService } from '@/services/recommender.service';

/** Recommends books from the customer's order history. */
export async function GET(request: Request) {
  const session = await requireCustomer(request);
  return NextResponse.json(await recommenderService.suggest(session.customerId));
}
