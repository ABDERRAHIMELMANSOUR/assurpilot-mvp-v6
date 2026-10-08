// scripts/purge-calls.ts
//
// Deletes every call record and nothing else.
//
// Run:  npm run db:purge-calls -- --yes
//       npm run db:purge-calls -- --yes --batches   (also clears the import log)
//
// What it touches:
//   call_results   DELETED  (part of the call history, and a foreign key on
//                            calls — Postgres refuses to delete a call while
//                            its result row still points at it)
//   calls          DELETED
//   import_batches DELETED only with --batches
//
// What it never touches: users, teams, phone_lines, call_result_options,
// keyyo_config, login_logs. The script counts those rows before and after and
// fails loudly if any of them moved, so "only calls were removed" is verified
// rather than asserted.
//
// Irreversible. There is no undo; take a backup first if the data matters.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Tables that must be byte-for-byte identical before and after. */
async function preservedCounts() {
  const [users, teams, phoneLines, resultOptions, keyyo, loginLogs] = await Promise.all([
    prisma.user.count(),
    prisma.team.count(),
    prisma.phoneLine.count(),
    prisma.callResultOption.count(),
    prisma.keyyoConfig.count(),
    prisma.loginLog.count(),
  ]);
  return { users, teams, phoneLines, resultOptions, keyyo, loginLogs };
}

function render(label: string, counts: Record<string, number>) {
  console.log(`\n${label}`);
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(16)} ${value}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes");
  const alsoBatches = args.includes("--batches");

  const before = await preservedCounts();
  const [calls, results, batches] = await Promise.all([
    prisma.call.count(),
    prisma.callResult.count(),
    prisma.importBatch.count(),
  ]);

  console.log("AssurPilot — purge de l'historique d'appels");
  render("À supprimer :", {
    calls,
    call_results: results,
    ...(alsoBatches ? { import_batches: batches } : {}),
  });
  render("À conserver (inchangé) :", before);

  if (!confirmed) {
    console.log(
      "\nAucune modification effectuée. Relancez avec --yes pour confirmer :" +
        "\n  npm run db:purge-calls -- --yes\n"
    );
    return;
  }

  // One transaction: a half-finished purge would leave results orphaned.
  // Order matters — call_results references calls.
  await prisma.$transaction(async (tx) => {
    await tx.callResult.deleteMany();
    await tx.call.deleteMany();
    if (alsoBatches) await tx.importBatch.deleteMany();
  });

  const after = await preservedCounts();
  const [callsAfter, resultsAfter] = await Promise.all([
    prisma.call.count(),
    prisma.callResult.count(),
  ]);

  render("Après purge — appels :", { calls: callsAfter, call_results: resultsAfter });
  render("Après purge — conservé :", after);

  const drifted = Object.keys(before).filter(
    (key) => before[key as keyof typeof before] !== after[key as keyof typeof after]
  );
  if (drifted.length) {
    throw new Error(
      `Des tables hors périmètre ont changé : ${drifted.join(", ")}. ` +
        "Vérifiez immédiatement la base."
    );
  }
  if (callsAfter !== 0 || resultsAfter !== 0) {
    throw new Error("La purge est incomplète : il reste des appels en base.");
  }

  console.log("\n✅ Historique d'appels vidé. Aucun profil, équipe ou ligne modifié.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
