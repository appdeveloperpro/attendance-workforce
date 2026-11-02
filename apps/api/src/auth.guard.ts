import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verify } from 'jsonwebtoken';
import { AuthRequest } from './auth.types';
import { PrismaService } from './prisma.service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined;
    const secret = process.env.JWT_SECRET;

    if (!token || !secret) {
      throw new UnauthorizedException('Sign in is required.');
    }

    let payload;
    try {
      payload = verify(token, secret);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }
    if (typeof payload === 'string' || !payload.sub) {
      throw new UnauthorizedException('Invalid access token.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: String(payload.sub) },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('This account is inactive. Contact your administrator.');
    }
    request.user = user;
    return true;
  }
}
