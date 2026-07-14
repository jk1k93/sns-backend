import "dotenv/config";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const CRICKET_ROLES = [
  "Batsman",
  "Bowler",
  "All Rounder",
  "Wicket Keeper Batsman",
];

const SPORTS = ["Cricket", "Badminton", "Football"];

async function main() {
  for (const name of CRICKET_ROLES) {
    await prisma.cricketRole.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Seeded ${CRICKET_ROLES.length} cricket roles`);

  for (const name of SPORTS) {
    await prisma.sport.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`Seeded ${SPORTS.length} sports`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
