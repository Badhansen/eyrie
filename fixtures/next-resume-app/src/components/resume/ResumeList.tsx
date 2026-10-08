'use client';
import Link from 'next/link';
import { useResumes } from '@/hooks/useResumes';

export function ResumeList() {
  const resumes = useResumes();
  return (
    <ul>
      {resumes.map((r) => (
        <li key={r.id}>
          <Link href={`/resume/${r.id}`}>{r.title}</Link>
        </li>
      ))}
    </ul>
  );
}
