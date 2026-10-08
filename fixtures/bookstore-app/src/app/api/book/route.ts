import { NextResponse } from 'next/server';
import { catalogService } from '@/services/catalog.service';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q');
  return NextResponse.json(query ? await catalogService.find(query) : await catalogService.browse());
}
