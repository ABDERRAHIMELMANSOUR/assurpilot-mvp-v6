// src/lib/routingEvents.ts
//
// What a coach did, worded for the administrator. Pure — no database, no request —
// and client-safe: the admin page imports the types and labels, the API routes
// build the events with `routingChanges` / `accountChanges`, and the store
// (routingNotificationsStore.ts) writes them.
//
// One event per thing that changed, so "Appels entrants coupés" and "Boost retiré"
// are two lines even when one click did both (muting clears the boost).

export const ROUTING_EVENT_KINDS = [
  "ACTIVATION_ON",
  "ACTIVATION_OFF",
  "BOOST_ON",
  "BOOST_OFF",
  "ADVISER_CREATED",
  "ADVISER_UPDATED",
  "ADVISER_DEACTIVATED",
  "ADVISER_REACTIVATED",
] as const;

export type RoutingEventKind = (typeof ROUTING_EVENT_KINDS)[number];

export const ROUTING_EVENT_LABEL: Record<RoutingEventKind, string> = {
  ACTIVATION_ON: "Appels entrants activés",
  ACTIVATION_OFF: "Appels entrants désactivés",
  BOOST_ON: "Boost activé",
  BOOST_OFF: "Boost retiré",
  ADVISER_CREATED: "Conseiller créé",
  ADVISER_UPDATED: "Fiche conseiller modifiée",
  ADVISER_DEACTIVATED: "Compte désactivé",
  ADVISER_REACTIVATED: "Compte réactivé",
};

/** Tone of the badge shown for each kind on the admin page. */
export const ROUTING_EVENT_TONE: Record<RoutingEventKind, "green" | "red" | "amber" | "gray" | "blue"> = {
  ACTIVATION_ON: "green",
  ACTIVATION_OFF: "red",
  BOOST_ON: "amber",
  BOOST_OFF: "gray",
  ADVISER_CREATED: "blue",
  ADVISER_UPDATED: "blue",
  ADVISER_DEACTIVATED: "red",
  ADVISER_REACTIVATED: "green",
};

/** One action, as stored and as returned to the admin page. */
export type RoutingNotification = {
  id: string;
  createdAt: string;
  kind: RoutingEventKind;
  message: string;
  actorId: string | null;
  actorName: string;
  actorRole: string;
  adviserId: string | null;
  adviserName: string | null;
  details: Record<string, unknown> | null;
  readAt: string | null;
};

/** An event before it is stored: who and when are added by the store. */
export type RoutingEventDraft = {
  kind: RoutingEventKind;
  details?: Record<string, unknown>;
};

type Switches = { isActiveForCalls: boolean; isBoosted: boolean };

/** The switch changes between two settled states — nothing when nothing moved. */
export function routingChanges(before: Switches, after: Switches): RoutingEventDraft[] {
  const out: RoutingEventDraft[] = [];
  if (before.isActiveForCalls !== after.isActiveForCalls) {
    out.push({ kind: after.isActiveForCalls ? "ACTIVATION_ON" : "ACTIVATION_OFF" });
  }
  if (before.isBoosted !== after.isBoosted) {
    out.push({
      kind: after.isBoosted ? "BOOST_ON" : "BOOST_OFF",
      // A boost cleared by muting the adviser was not asked for on its own.
      details: !after.isBoosted && !after.isActiveForCalls ? { cause: "appels désactivés" } : undefined,
    });
  }
  return out;
}

/** Field names a coach may change on an adviser's account, worded for the admin. */
const FIELD_LABEL: Record<string, string> = {
  nom: "nom",
  prenom: "prénom",
  email: "email",
  phoneNumber: "ligne directe",
  password: "mot de passe",
};

type Account = { nom: string; prenom: string; email: string; phoneNumber: string; isActive: boolean };

/**
 * The account changes between two versions of an adviser. Activation is its own
 * event (it takes the adviser in or out of routing); the other fields are one
 * "fiche modifiée" event listing them, with old → new for the direct line.
 */
export function accountChanges(before: Account, after: Account, passwordChanged = false): RoutingEventDraft[] {
  const out: RoutingEventDraft[] = [];
  if (before.isActive !== after.isActive) {
    out.push({ kind: after.isActive ? "ADVISER_REACTIVATED" : "ADVISER_DEACTIVATED" });
  }
  const fields = (["nom", "prenom", "email", "phoneNumber"] as const).filter((f) => before[f] !== after[f]);
  if (passwordChanged) (fields as string[]).push("password");
  if (fields.length) {
    const details: Record<string, unknown> = { champs: fields.map((f) => FIELD_LABEL[f] ?? f) };
    if (before.phoneNumber !== after.phoneNumber) {
      details.ancienneLigne = before.phoneNumber || null;
      details.nouvelleLigne = after.phoneNumber || null;
    }
    out.push({ kind: "ADVISER_UPDATED", details });
  }
  return out;
}

const ROLE_WORD: Record<string, string> = { SUPERVISEUR: "Coach", ADMINISTRATEUR: "Admin" };

/** The sentence shown in the notification: "Coach Karim B. a désactivé les appels entrants de Sara M.". */
export function routingMessage(
  kind: RoutingEventKind,
  actor: { name: string; role: string },
  adviserName: string | null,
  details?: Record<string, unknown>
): string {
  const who = `${ROLE_WORD[actor.role] ?? ""} ${actor.name}`.trim();
  const of = adviserName ?? "un conseiller";
  switch (kind) {
    case "ACTIVATION_ON":
      return `${who} a activé les appels entrants de ${of}`;
    case "ACTIVATION_OFF":
      return `${who} a désactivé les appels entrants de ${of}`;
    case "BOOST_ON":
      return `${who} a boosté ${of}`;
    case "BOOST_OFF":
      return details?.cause
        ? `${who} a retiré le boost de ${of} (${details.cause})`
        : `${who} a retiré le boost de ${of}`;
    case "ADVISER_CREATED":
      return `${who} a créé le conseiller ${of}`;
    case "ADVISER_UPDATED": {
      const fields = Array.isArray(details?.champs) ? (details!.champs as string[]).join(", ") : "";
      const line =
        details && "nouvelleLigne" in details
          ? ` — ligne ${details.ancienneLigne ?? "vide"} → ${details.nouvelleLigne ?? "vide"}`
          : "";
      return `${who} a modifié la fiche de ${of}${fields ? ` (${fields})` : ""}${line}`;
    }
    case "ADVISER_DEACTIVATED":
      return `${who} a désactivé le compte de ${of}`;
    case "ADVISER_REACTIVATED":
      return `${who} a réactivé le compte de ${of}`;
  }
}
