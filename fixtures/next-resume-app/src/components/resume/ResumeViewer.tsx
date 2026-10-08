'use client';
import { useEffect, useState } from 'react';

export default function ResumeViewer({ id }: { id: string }) {
  const [resume, setResume] = useState<unknown>(null);
  useEffect(() => {
    fetch(`/api/resume/${id}`).then((r) => r.json()).then(setResume);
  }, [id]);
  return <pre>{JSON.stringify(resume, null, 2)}</pre>;
}
