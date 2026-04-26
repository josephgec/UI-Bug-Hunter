import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __ubhPrisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  globalThis.__ubhPrisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__ubhPrisma = prisma;
}

export * from "@prisma/client";
