import { createAccessControl } from 'better-auth/plugins/access';
import {
  adminAc,
  defaultStatements,
} from 'better-auth/plugins/admin/access';

const statements = { ...defaultStatements } as const;

export const authAccess = createAccessControl(statements);
export const adminRole = authAccess.newRole({ ...adminAc.statements });
export const engineerRole = authAccess.newRole({ user: [], session: [] });
