import { NextResponse } from 'next/server';
import { requireUser } from '@/services/auth.service';
import { resumeService } from '@/services/resume.service';

/** Generates a tailored resume from the current CV and a job description. */
export async function POST(request: Request) {
  const user = await requireUser(request);
  const { cv, jobDescription } = await request.json();
  const resume = await resumeService.generate(user.userId, cv, jobDescription);
  return NextResponse.json(resume);
}
