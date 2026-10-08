import { NextResponse, type NextRequest } from 'next/server';

/** Redirects anonymous visitors away from the dashboard. */
export function middleware(request: NextRequest) {
  if (!request.cookies.get('session')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/dashboard/:path*', '/order/:path*'] };
