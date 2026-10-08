import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth.service';
import { resumeService } from '@/services/resume.service';

export async function GET(request: Request) {
  const user = await requireUser(request);
  return NextResponse.json(await resumeService.list(user.userId));
}
