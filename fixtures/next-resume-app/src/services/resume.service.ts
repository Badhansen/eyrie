import { AIService } from './ai.service';
import { ResumeRepository } from '@/repositories/resume.repository';
import { buildResumePrompt } from '@/lib/prompt';

/**
 * Generates tailored resumes from the user's current CV and a job description.
 */
export class ResumeService {
  private ai = new AIService();

  constructor(private readonly repo: ResumeRepository) {}

  async generate(userId: string, cv: string, jobDescription: string) {
    const prompt = buildResumePrompt(cv, jobDescription);
    const tailored = await this.ai.complete(prompt);
    return this.repo.save(userId, 'Tailored resume', { text: tailored });
  }

  async list(userId: string) {
    return this.repo.findByUser(userId);
  }
}

export const resumeService = new ResumeService(new ResumeRepository());
