import { prisma } from '@/lib/prisma';

/** Persistence for resumes and their versions. */
export class ResumeRepository {
  async findByUser(userId: string) {
    return prisma.resume.findMany({ where: { userId } });
  }

  async findById(id: string) {
    return prisma.resume.findUnique({ where: { id } });
  }

  async save(userId: string, title: string, content: unknown) {
    const resume = await prisma.resume.create({ data: { userId, title, content: content as object } });
    await prisma.resumeVersion.create({ data: { resumeId: resume.id, content: content as object } });
    return resume;
  }
}
