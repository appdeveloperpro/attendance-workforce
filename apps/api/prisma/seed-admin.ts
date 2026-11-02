import 'dotenv/config';
import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

async function seedAdmin() {
  const { ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, JWT_SECRET } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_NAME || !ADMIN_PASSWORD || !JWT_SECRET) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, and JWT_SECRET before seeding.');
  }
  if (JWT_SECRET.length < 32 || ADMIN_PASSWORD.length < 12) {
    throw new Error('JWT_SECRET must be 32+ characters and ADMIN_PASSWORD 12+ characters.');
  }
  const prisma = new PrismaClient();
  try {
    const email = ADMIN_EMAIL.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role === 'ADMIN') {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: 'SUPERADMIN', isActive: true },
        });
        console.log(`Upgraded existing administrator ${email} to superadmin.`);
        return;
      }
      if (existing.role === 'SUPERADMIN') {
        console.log(`Superadmin ${email} already exists.`);
        return;
      }
      throw new Error(`An employee account already exists for ${email}; refusing to change it.`);
    }
    await prisma.user.create({
      data: {
        name: ADMIN_NAME.trim(),
        email,
        passwordHash: await hash(ADMIN_PASSWORD, 12),
        role: 'SUPERADMIN',
      },
    });
    console.log(`Created initial superadmin ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void seedAdmin().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
