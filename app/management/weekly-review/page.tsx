import type { Metadata } from 'next';
import { listActiveUserNames } from '../../../db/auth-users';
import { listActiveTeamNames } from '../../../db/team-settings';
import { requireAdmin } from '../../../lib/auth-session';
import { isoWeekForDate } from '../../../lib/weekly-review';
import WeeklyIntegrationReview from './weekly-integration-review';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Weekly integration review',
  description: 'A structured weekly view of engineering delivery activity.',
};

export default async function WeeklyReviewPage() {
  const identity = await requireAdmin('/management/weekly-review');
  const [engineerNames, teamNames] = await Promise.all([
    listActiveUserNames(),
    listActiveTeamNames(),
  ]);
  return (
    <WeeklyIntegrationReview
      currentUserName={identity.name}
      engineerNames={engineerNames}
      teamNames={teamNames}
      initialWeek={isoWeekForDate(new Date())}
    />
  );
}
