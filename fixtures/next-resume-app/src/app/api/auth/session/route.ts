import { NextResponse } from 'next/server';
import { getSession } from '@/services/auth.service';

export async function GET(request: Request) {
  return NextResponse.json(await getSession(request));
}
