'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

/** Lets the user paste a job description and generate a tailored resume. */
export function ResumeEditor({ cv }: { cv: string }) {
  const [job, setJob] = useState('');
  const [result, setResult] = useState('');

  async function generate() {
    const res = await fetch('/api/resume/generate', {
      method: 'POST',
      body: JSON.stringify({ cv, jobDescription: job }),
    });
    setResult(JSON.stringify(await res.json()));
  }

  return (
    <div>
      <textarea value={job} onChange={(e) => setJob(e.target.value)} />
      <Button onClick={generate}>Generate</Button>
      <pre>{result}</pre>
    </div>
  );
}
