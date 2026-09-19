import type { Metadata } from 'next';
import EngineeringWorkspace from './engineering-workspace';

export const metadata: Metadata = {
  title: 'Engineering',
  description: 'Create work items, own results, and complete assigned actions.',
};

export default function EngineeringPage() {
  return <EngineeringWorkspace />;
}

