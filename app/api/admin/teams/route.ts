import { teamSettings } from '../../../../db/team-settings';
import { identityFromHeaders } from '../../../../lib/auth-session';
import { createTeamSettingsHandlers } from '../../../../lib/team-settings-api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const { GET, POST, PATCH, DELETE } = createTeamSettingsHandlers(
  teamSettings,
  (request) => identityFromHeaders(request.headers),
);
