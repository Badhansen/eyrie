import { truncate } from '@/utils/format';

/** Builds the LLM prompt for tailoring a resume to a job description. */
export function buildResumePrompt(resume: string, jobDescription: string): string {
  return `Tailor this resume:\n${truncate(resume, 8000)}\n\nFor this job:\n${truncate(jobDescription, 4000)}`;
}
