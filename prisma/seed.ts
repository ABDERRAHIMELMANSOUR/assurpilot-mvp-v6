// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { LINE_ROUTES } from "../src/lib/phone";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding AssurPilot database...");

  await prisma.loginLog.deleteMany();
  await prisma.callResult.deleteMany();
  await prisma.call.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.user.deleteMany();
  await prisma.phoneLine.deleteMany();
  await prisma.team.deleteMany();
  await prisma.callResultOption.deleteMany();
  await prisma.keyyoConfig.deleteMany();

  // ── Configurable result options ──────────────────────────────────────────────
  await prisma.callResultOption.createMany({
    data: [
      { label: "Devis réalisé",  value: "DEVIS_REALISE",  color: "green",  isActive: true, order: 0 },
      { label: "Information",    value: "INFORMATION",    color: "blue",   isActive: true, order: 1 },
      { label: "Non intéressé",  value: "NON_INTERESSE",  color: "red",    isActive: true, order: 2 },
      { label: "Rappel prévu",   value: "RAPPEL_PREVU",   color: "yellow", isActive: true, order: 3 },
      { label: "Devis envoyé",   value: "DEVIS_ENVOYE",   color: "purple", isActive: true, order: 4 },
      { label: "Faux numéro",    value: "FAUX_NUMERO",    color: "gray",   isActive: true, order: 5 },
    ],
  });

  // ── Teams ─────────────────────────────────────────────────────────────────────
  const teamAuto = await prisma.team.create({
    data: { nom: "Pôle Auto", description: "Assurances auto" },
  });
  await prisma.team.create({
    data: { nom: "Pôle Santé", description: "Complémentaires santé et prévoyance" },
  });

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);
  const now  = new Date();

  // ── Users ─────────────────────────────────────────────────────────────────────
  await prisma.user.create({
    data: {
      email: "admin@assurpilot.fr", password: hash("admin123"),
      nom: "Martin", prenom: "François",
      phoneNumber: "+33 1 00 00 00 01",
      role: "ADMINISTRATEUR",
      lastLoginAt: new Date(now.getTime() - 1000 * 60 * 30),
    },
  });

  const coach = await prisma.user.create({
    data: {
      email: "coach@assurpilot.fr", password: hash("coach123"),
      nom: "Dubois", prenom: "Claire",
      phoneNumber: "+33 6 00 00 00 02",
      role: "SUPERVISEUR",
      teamId: teamAuto.id,
      lastLoginAt: new Date(now.getTime() - 1000 * 60 * 60 * 2),
    },
  });
  await prisma.team.update({
    where: { id: teamAuto.id },
    data: { superviseurId: coach.id },
  });

  const agent1 = await prisma.user.create({
    data: {
      email: "marie.laurent@assurpilot.fr", password: hash("agent123"),
      nom: "Laurent", prenom: "Marie",
      // This phone number must match what appears in "Numéro appelé" in imported files
      phoneNumber: "0988288362",
      role: "CONSEILLER",
      teamId: teamAuto.id,
      superviseurId: coach.id,
      lastLoginAt: new Date(now.getTime() - 1000 * 60 * 10),
    },
  });
  const agent2 = await prisma.user.create({
    data: {
      email: "pierre.durand@assurpilot.fr", password: hash("agent123"),
      nom: "Durand", prenom: "Pierre",
      // This phone number must match what appears in "Numéro appelé" in imported files
      phoneNumber: "0180873462",
      role: "CONSEILLER",
      teamId: teamAuto.id,
      superviseurId: coach.id,
      lastLoginAt: new Date(now.getTime() - 1000 * 60 * 45),
    },
  });

  // ── Business phone lines (the 2 real lines) ───────────────────────────────────
  // numeroMasque stores the actual line number used for matching during import
  // "Numéro appelé" in Keyyo files = the line that received the call
  // The four production lines, each owned by the team that answers it. Imports
  // route on these numbers (see src/lib/phone.ts), so team + line must agree.
  const routedTeams = new Map<string, string>();
  const routedLines = new Map<string, { id: string }>();
  for (const route of LINE_ROUTES) {
    let teamId = routedTeams.get(route.team);
    if (!teamId) {
      const team = await prisma.team.create({
        data: { nom: route.team, description: `Appels reçus sur ${route.label}` },
      });
      teamId = team.id;
      routedTeams.set(route.team, teamId);
    }
    const line = await prisma.phoneLine.create({
      data: { label: route.label, numeroMasque: route.numero, isActive: true, teamId },
    });
    routedLines.set(route.numero, { id: line.id });
  }

  // Kept under their historical names for the sample calls below.
  const lineAuto = routedLines.get("0988288362")!;
  const lineSante = routedLines.get("0180873462")!;

  // ── Keyyo config ──────────────────────────────────────────────────────────────
  await prisma.keyyoConfig.create({
    data: {
      webhookUrl:      "https://votre-domaine.fr/webhooks/voip/keyyo",
      distributionMode:"ROUND_ROBIN",
      maxRingSeconds:  30,
      isActive:        false,
    },
  });

  // ── Helper ────────────────────────────────────────────────────────────────────
  function daysAgo(days: number, hour: number, minute: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - days);
    d.setHours(hour, minute, 0, 0);
    return d;
  }

  // ── Sample calls — Marie (Ligne Auto = 0988288362) ───────────────────────────
  const marieCalls = [
    { line: lineAuto,  caller: "+33 6 12 34 56 42", isMissed: false, dur: 374, at: daysAgo(0,14,23), res: "DEVIS_REALISE",  notes: "Assurance auto tout risque, véhicule récent" },
    { line: lineAuto,  caller: "+33 7 65 43 21 18", isMissed: false, dur: 125, at: daysAgo(0,13,47), res: "INFORMATION",    notes: "Questions sur garantie" },
    { line: lineAuto,  caller: "+33 6 98 76 54 32", isMissed: true,  dur: 0,   at: daysAgo(0,12,10), res: null,            notes: null },
    { line: lineAuto,  caller: "+33 6 11 22 33 91", isMissed: false, dur: 527, at: daysAgo(0,11,32), res: "DEVIS_REALISE",  notes: "Famille 2 voitures, multi-garanties" },
    { line: lineAuto,  caller: "+33 9 44 55 66 07", isMissed: false, dur: 89,  at: daysAgo(1,16, 5), res: "NON_INTERESSE",  notes: "Déjà assuré" },
    { line: lineAuto,  caller: "+33 6 77 88 99 55", isMissed: false, dur: 412, at: daysAgo(1,10,30), res: "RAPPEL_PREVU",   notes: "Rappeler jeudi matin" },
    { line: lineAuto,  caller: "+33 7 12 98 76 54", isMissed: true,  dur: 0,   at: daysAgo(2, 9,15), res: null,            notes: null },
    { line: lineAuto,  caller: "+33 7 33 44 55 33", isMissed: false, dur: 290, at: daysAgo(2,15,45), res: "DEVIS_REALISE",  notes: "Young driver, primo-assurance" },
    { line: lineAuto,  caller: "+33 6 55 66 77 78", isMissed: false, dur: 180, at: daysAgo(3,11,20), res: "INFORMATION",    notes: "Comparaison tarifs" },
    { line: lineAuto,  caller: "+33 6 22 33 44 55", isMissed: true,  dur: 0,   at: daysAgo(4, 8,50), res: null,            notes: null },
  ];

  // ── Sample calls — Pierre (Ligne Santé = 0180873462) ─────────────────────────
  const pierreCalls = [
    { line: lineSante, caller: "+33 6 10 20 30 12", isMissed: false, dur: 445, at: daysAgo(0,15,10), res: "DEVIS_REALISE",  notes: "Appartement Paris 75011" },
    { line: lineSante, caller: "+33 7 88 99 00 88", isMissed: false, dur: 210, at: daysAgo(0,14, 0), res: "INFORMATION",    notes: "Résiliation en cours" },
    { line: lineSante, caller: "+33 6 31 42 53 64", isMissed: true,  dur: 0,   at: daysAgo(0,10,22), res: null,            notes: null },
    { line: lineSante, caller: "+33 6 64 75 86 97", isMissed: false, dur: 603, at: daysAgo(1,11,50), res: "DEVIS_REALISE",  notes: "Mutuelle famille 4 personnes" },
    { line: lineSante, caller: "+33 9 27 38 49 50", isMissed: false, dur: 95,  at: daysAgo(1, 9,35), res: "NON_INTERESSE",  notes: "Couverture actuelle suffisante" },
    { line: lineSante, caller: "+33 6 39 48 57 66", isMissed: false, dur: 320, at: daysAgo(2,14,40), res: "RAPPEL_PREVU",   notes: "En déplacement" },
    { line: lineSante, caller: "+33 7 90 01 12 23", isMissed: true,  dur: 0,   at: daysAgo(3, 9, 5), res: null,            notes: null },
    { line: lineSante, caller: "+33 7 51 62 73 84", isMissed: false, dur: 267, at: daysAgo(3,16,30), res: "DEVIS_REALISE",  notes: "Mutuelle individuelle" },
  ];

  for (const c of marieCalls) {
    const call = await prisma.call.create({
      data: {
        phoneLineId: c.line.id, assignedUserId: agent1.id,
        teamId: (await prisma.phoneLine.findUnique({ where: { id: c.line.id }, select: { teamId: true } }))?.teamId ?? null,
        callerNumber: c.caller, isMissed: c.isMissed,
        durationSeconds: c.dur,
        statut: c.isMissed ? "MANQUE" : "REPONDU",
        startedAt: c.at,
        endedAt: c.isMissed ? null : new Date(c.at.getTime() + c.dur * 1000),
      },
    });
    if (c.res) {
      await prisma.callResult.create({ data: { callId: call.id, userId: agent1.id, resultat: c.res, notes: c.notes } });
    }
  }

  for (const c of pierreCalls) {
    const call = await prisma.call.create({
      data: {
        phoneLineId: c.line.id, assignedUserId: agent2.id,
        teamId: (await prisma.phoneLine.findUnique({ where: { id: c.line.id }, select: { teamId: true } }))?.teamId ?? null,
        callerNumber: c.caller, isMissed: c.isMissed,
        durationSeconds: c.dur,
        statut: c.isMissed ? "MANQUE" : "REPONDU",
        startedAt: c.at,
        endedAt: c.isMissed ? null : new Date(c.at.getTime() + c.dur * 1000),
      },
    });
    if (c.res) {
      await prisma.callResult.create({ data: { callId: call.id, userId: agent2.id, resultat: c.res, notes: c.notes } });
    }
  }

  console.log("✅ Seed terminé !");
  console.log("\n📋 Comptes de test :");
  console.log("  👑 Admin     : admin@assurpilot.fr          / admin123");
  console.log("  🎯 Coach     : coach@assurpilot.fr          / coach123");
  console.log("  👤 Conseiller: marie.laurent@assurpilot.fr  / agent123  (ligne Auto  0988288362)");
  console.log("  👤 Conseiller: pierre.durand@assurpilot.fr  / agent123  (ligne Santé 0180873462)");
  console.log("\n📞 Lignes configurées (routage des imports) :");
  for (const route of LINE_ROUTES) {
    console.log(`  ${route.numero}  →  ${route.team}   (${route.label})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
