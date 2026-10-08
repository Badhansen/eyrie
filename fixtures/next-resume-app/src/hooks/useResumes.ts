'use client';
import { useEffect, useState } from 'react';

export function useResumes() {
  const [resumes, setResumes] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    fetch('/api/resume').then((r) => r.json()).then(setResumes);
  }, []);
  return resumes;
}
