/**
 * Seed a tournament's teams with random players.
 *
 * Usage:
 *   npx tsx scripts/seed-random-players.ts <tournamentId> [playersPerTeam] [--force]
 *
 * Creates `playersPerTeam` (default 13) brand-new fake Users per team, each
 * added as a TournamentPlayer assigned to that team. Since each generated
 * user is used exactly once, no player ends up on two different teams.
 *
 * Refuses to run if the tournament already has players seeded, unless
 * --force is passed (to avoid accidentally doubling up on a re-run).
 */
import "dotenv/config";
import { prisma } from "../src/db.js";

const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna",
  "Ishaan", "Rohan", "Karan", "Aryan", "Dev", "Yash", "Kabir", "Rudra",
  "Ananya", "Diya", "Ishita", "Kavya", "Meera", "Neha", "Priya", "Riya",
  "Saanvi", "Tara", "Vidya", "Zara", "Aisha", "Bhavya", "Sanjay", "Rahul",
  "Amit", "Vikram", "Suresh", "Rajesh", "Manoj", "Deepak", "Anil", "Ravi",
];

const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Patel", "Reddy", "Iyer", "Nair", "Menon",
  "Kapoor", "Malhotra", "Chopra", "Mehta", "Joshi", "Rao", "Pillai", "Desai",
  "Kulkarni", "Bhat", "Shetty", "Singh", "Yadav", "Chauhan", "Thakur", "Naidu",
];

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomName(): string {
  return `${randomOf(FIRST_NAMES)} ${randomOf(LAST_NAMES)}`;
}

function randomPhone(taken: Set<string>): string {
  let phone: string;
  do {
    phone = "9" + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  } while (taken.has(phone));
  return phone;
}

async function main() {
  const tournamentId = process.argv[2];
  const playersPerTeamArg = process.argv.find((a) => /^\d+$/.test(a) && a !== tournamentId);
  const force = process.argv.includes("--force");
  const playersPerTeam = playersPerTeamArg ? parseInt(playersPerTeamArg, 10) : 13;

  if (!tournamentId) {
    console.error("Usage: npx tsx scripts/seed-random-players.ts <tournamentId> [playersPerTeam] [--force]");
    process.exit(1);
  }

  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId, isDeleted: false },
    select: { id: true, name: true },
  });
  if (!tournament) {
    console.error(`Tournament ${tournamentId} not found (or deleted).`);
    process.exit(1);
  }

  const teams = await prisma.team.findMany({
    where: { tournamentId, isDeleted: false },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (teams.length === 0) {
    console.error(`Tournament "${tournament.name}" has no teams — create teams first.`);
    process.exit(1);
  }

  const existingPlayerCount = await prisma.tournamentPlayer.count({
    where: { tournamentId, isDeleted: false },
  });
  if (existingPlayerCount > 0 && !force) {
    console.error(
      `Tournament "${tournament.name}" already has ${existingPlayerCount} player(s). ` +
      `Re-run with --force to add ${playersPerTeam * teams.length} more anyway.`,
    );
    process.exit(1);
  }

  console.log(
    `Tournament: "${tournament.name}" — ${teams.length} team(s), ` +
    `seeding ${playersPerTeam} players each (${playersPerTeam * teams.length} total).`,
  );

  const existingPhones = new Set(
    (await prisma.user.findMany({ select: { phoneNumber: true } })).map((u) => u.phoneNumber),
  );

  let created = 0;
  for (const team of teams) {
    for (let i = 1; i <= playersPerTeam; i++) {
      const phone = randomPhone(existingPhones);
      existingPhones.add(phone);

      const user = await prisma.user.create({
        data: { name: randomName(), phoneNumber: phone },
        select: { id: true },
      });

      await prisma.tournamentPlayer.create({
        data: {
          tournamentId,
          playerId: user.id,
          teamId: team.id,
          jerseyNumber: i,
        },
      });
      created++;
    }
    console.log(`  ${team.name}: ${playersPerTeam} players added`);
  }

  console.log(`Done — created ${created} players across ${teams.length} teams.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
