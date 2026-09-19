import type { Metadata } from 'next';
import ManagementDashboard from './management-dashboard';

export const metadata: Metadata = {
  title: 'Management',
  description:
    'Organization-wide work visibility, Kanban flow, and delivery scheduling.',
};

export default function ManagementPage() {
  return <ManagementDashboard />;
}
