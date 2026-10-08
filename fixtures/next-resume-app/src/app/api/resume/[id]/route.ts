import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth.service';
import { ResumeRepository } from '@/repositories/resume.repository';

const repo = new ResumeRepository();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const { id } = await params;
  return NextResponse.json(await repo.findById(id));
}
