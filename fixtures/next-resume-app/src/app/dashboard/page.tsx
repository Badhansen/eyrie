import { ResumeEditor } from '@/components/resume/ResumeEditor';
import { ResumeList } from '@/components/resume/ResumeList';

export default function DashboardPage() {
  return (
    <main>
      <ResumeList />
      <ResumeEditor cv="" />
    </main>
  );
}
