import type { UserRole } from './roles.decorator';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
};

import { Request } from 'express';

export type AuthRequest = Request & { user: AuthUser };
