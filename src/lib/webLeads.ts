// src/lib/webLeads.ts
//
// Leads sent by an EXTERNAL website form (POST /api/leads/proassur/auto-alm). Pure functions —
// no database, no request — so the reading and the checks can be tested on their own.
//
// Nothing here changes how calls work: a web lead is stored as one more call of the team
// (rawMeta.source = "web-lead") and sent with the existing push to the CRM.
import { normalizePhone } from "@/lib/phone";

export type WebLead = {
  telephone: string;          // national form, 10 digits (06…)
  nom: string;
  prenom: string;
  email: string;
  codePostal: string;
  dateNaissance: string;      // AAAA-MM-JJ when given
  commentaire: string;
  source: string;             // free label of the form ("site-auto", "landing-google"…)
  consentement: boolean | null;
  /** Anti-bot field: a human never fills it. */
  honeypot: boolean;
};

export type LeadCheck = { ok: true; lead: WebLead } | { ok: false; errors: Record<string, string> };

type Obj = Record<string, unknown>;

/** Names accepted for each field (compared without case, accents or separators). */
const FIELDS: Record<keyof Omit<WebLead, "honeypot" | "consentement">, string[]> = {
  telephone: ["telephone", "tel", "phone", "mobile", "portable", "numero", "phone_number"],
  nom: ["nom", "lastname", "last_name", "name_last", "family_name"],
  prenom: ["prenom", "firstname", "first_name", "given_name"],
  email: ["email", "mail", "e_mail", "courriel"],
  codePostal: ["code_postal", "cp", "zip", "postal_code", "zipcode"],
  dateNaissance: ["date_naissance", "naissance", "birthdate", "date_of_birth", "dob"],
  commentaire: ["commentaire", "comment", "message", "remarque"],
  source: ["source", "origine", "utm_source", "formulaire"],
};
const CONSENT = ["consentement", "consent", "rgpd", "optin", "opt_in"];
const HONEYPOT = ["website", "url_site", "hp"];

const key = (k: string) => k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** One line of plain text: no control characters, no template braces, collapsed spaces. */
function clean(v: unknown, max: number): string {
  if (v === null || v === undefined || typeof v === "object") return "";
  return String(v)
    .replace(/[\u0000-\u001f\u007f{}$<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Reads and checks one lead. `raw` = the JSON body or the form fields. */
export function readWebLead(raw: Obj): LeadCheck {
  const flat: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw ?? {})) flat[key(k)] = v;
  const get = (names: string[]) => {
    for (const n of names) {
      const v = flat[key(n)];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return undefined;
  };

  const errors: Record<string, string> = {};
  const rawPhone = clean(get(FIELDS.telephone), 30);
  const telephone = normalizePhone(rawPhone);
  if (!rawPhone) errors.telephone = "obligatoire";
  else if (!/^0[1-9]\d{8}$/.test(telephone)) errors.telephone = "numéro français invalide (10 chiffres, ex. 0612345678 ou +33612345678)";

  const email = clean(get(FIELDS.email), 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) errors.email = "adresse e-mail invalide";

  const codePostal = clean(get(FIELDS.codePostal), 10).replace(/\s/g, "");
  if (codePostal && !/^\d{5}$/.test(codePostal)) errors.code_postal = "5 chiffres";

  let dateNaissance = clean(get(FIELDS.dateNaissance), 20);
  const fr = dateNaissance.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (fr) dateNaissance = `${fr[3]}-${fr[2]}-${fr[1]}`;
  if (dateNaissance && (!/^\d{4}-\d{2}-\d{2}$/.test(dateNaissance) || Number.isNaN(new Date(`${dateNaissance}T00:00:00Z`).getTime()))) {
    errors.date_naissance = "format AAAA-MM-JJ (ou JJ/MM/AAAA)";
  }

  const consentRaw = get(CONSENT);
  const consentement = consentRaw === undefined ? null : /^(1|true|oui|yes|on)$/i.test(String(consentRaw).trim());
  const honeypot = get(HONEYPOT) !== undefined;

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    lead: {
      telephone,
      nom: clean(get(FIELDS.nom), 80),
      prenom: clean(get(FIELDS.prenom), 80),
      email,
      codePostal,
      dateNaissance,
      commentaire: clean(get(FIELDS.commentaire), 1000),
      source: clean(get(FIELDS.source), 80) || "site-web",
      consentement,
      honeypot,
    },
  };
}

/**
 * The CRM link for a web lead: the SAME link as for calls, except that its name fields
 * (NomTxt / PrenomTxt…) carry the lead's own name ($nom / $prenom) when the form gave one.
 * The stored link is not changed: this copy is used for this lead only.
 */
export function linkForWebLead(template: string, lead: Pick<WebLead, "nom" | "prenom">): string {
  let url: URL;
  try {
    url = new URL(template);
  } catch {
    return template;
  }
  const params = new URLSearchParams();
  for (const [k, v] of url.searchParams) {
    const name = key(k);
    if (lead.nom && /^(nom|lastname|name)/.test(name) && !/^nomtel/.test(name)) params.append(k, "$nom");
    else if (lead.prenom && /^(prenom|firstname)/.test(name)) params.append(k, "$prenom");
    else params.append(k, v);
  }
  url.search = params.toString();
  // URLSearchParams writes "$" as "%24": put the variables back as the template expects them.
  return url.toString().replace(/%24([a-z_]+)/g, "$$$1");
}
