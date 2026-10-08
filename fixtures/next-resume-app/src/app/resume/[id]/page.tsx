import dynamic from 'next/dynamic';

const ResumeViewer = dynamic(() => import('@/components/resume/ResumeViewer'));

export default async function ResumePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResumeViewer id={id} />;
}
