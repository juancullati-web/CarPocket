// CarPocket : seul point qui détient la clé GitHub et les droits d'administration.
// À déployer avec « Verify JWT » désactivé : chaque action vérifie ici la connexion.

const REPO = "juancullati-web/CarPocket";
const ALLOWED_ORIGINS = ["https://carpocket.inzight.fr", "https://juancullati-web.github.io", "http://localhost:8765"];
const LOGIN_DOMAIN = "users.carpocket.example";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const GITHUB_KEY = Deno.env.get("GH_ACTIONS_TOKEN") ?? "";

function serverKey(): string {
  try {
    const key = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
    if (key) return key;
  } catch { /* on passe à l'ancienne variable */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

function publicKey(): string {
  try {
    const key = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}").default;
    if (key) return key;
  } catch { /* on passe à l'ancienne variable */ }
  return Deno.env.get("SUPABASE_ANON_KEY")!;
}

/** Les nouvelles clés ne vont que dans « apikey » ; l'ancien format va aussi dans Authorization. */
function serverHeaders(): Record<string, string> {
  const key = serverKey();
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

async function currentUser(request: Request): Promise<{ id: string; role: string; username: string } | null> {
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return null;
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: publicKey(), Authorization: authorization },
  });
  if (!auth.ok) return null;
  const { id } = await auth.json();
  const rows = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${id}&select=id,role,username`, {
    headers: serverHeaders(),
  });
  if (!rows.ok) return null;
  const [profile] = await rows.json();
  return profile ?? null;
}

async function github(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "CarPocket",
      Authorization: `Bearer ${GITHUB_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

function runRobot(workflow: string, name: string): Promise<Response> {
  return github(`/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { name } }),
  });
}

function validTitle(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200;
}

function validUsername(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{2,30}$/.test(value);
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && value.length <= 72;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);
}

/** La voiture doit être dans la collection du demandeur : on ne lance pas le robot pour rien. */
async function inDeck(userId: string, title: string): Promise<boolean> {
  const url = `${SUPABASE_URL}/rest/v1/deck_items?user_id=eq.${userId}&title=eq.${encodeURIComponent(title)}&select=title`;
  const rows = await fetch(url, { headers: serverHeaders() });
  return rows.ok && (await rows.json()).length > 0;
}

type Answer = { status: number; body: Record<string, unknown> };

async function memberAction(user: { id: string }, action: string, input: Record<string, unknown>): Promise<Answer | null> {
  if (action === "request-car") {
    if (!validTitle(input.title)) return { status: 400, body: { error: "Nom de voiture invalide." } };
    if (!(await inDeck(user.id, input.title))) return { status: 403, body: { error: "Cette voiture n'est pas dans ta collection." } };
    const response = await runRobot("add-car.yml", input.title);
    return response.ok
      ? { status: 200, body: { started: true } }
      : { status: 502, body: { error: "Le robot n'a pas pu être lancé." } };
  }
  if (action === "car-status") {
    if (!validTitle(input.title)) return { status: 400, body: { error: "Nom de voiture invalide." } };
    const response = await github("/actions/runs?event=workflow_dispatch&per_page=30");
    if (!response.ok) return { status: 502, body: { error: "GitHub ne répond pas." } };
    const { workflow_runs: runs } = await response.json();
    const run = runs.find((r: { display_title: string }) => r.display_title === `Ajout de ${input.title}`);
    return {
      status: 200,
      body: { found: Boolean(run), failed: Boolean(run && run.status === "completed" && run.conclusion === "failure") },
    };
  }
  return null;
}

async function adminAction(action: string, input: Record<string, unknown>, self: { id: string }): Promise<Answer | null> {
  const authUrl = `${SUPABASE_URL}/auth/v1/admin/users`;
  if (action === "create-user") {
    if (!validUsername(input.username)) return { status: 400, body: { error: "Identifiant invalide : 2 à 30 lettres minuscules, chiffres, - ou _." } };
    if (!validPassword(input.password)) return { status: 400, body: { error: "Le mot de passe doit faire au moins 10 caractères." } };
    const response = await fetch(authUrl, {
      method: "POST",
      headers: serverHeaders(),
      body: JSON.stringify({ email: `${input.username}@${LOGIN_DOMAIN}`, password: input.password, email_confirm: true }),
    });
    return response.ok
      ? { status: 200, body: { created: true } }
      : { status: 400, body: { error: "Ce compte n'a pas pu être créé. L'identifiant existe peut-être déjà." } };
  }
  if (action === "set-password") {
    if (!validId(input.user_id)) return { status: 400, body: { error: "Compte invalide." } };
    if (!validPassword(input.password)) return { status: 400, body: { error: "Le mot de passe doit faire au moins 10 caractères." } };
    const response = await fetch(`${authUrl}/${input.user_id}`, {
      method: "PUT",
      headers: serverHeaders(),
      body: JSON.stringify({ password: input.password }),
    });
    return response.ok ? { status: 200, body: { updated: true } } : { status: 400, body: { error: "Le mot de passe n'a pas pu être changé." } };
  }
  if (action === "delete-user") {
    if (!validId(input.user_id)) return { status: 400, body: { error: "Compte invalide." } };
    if (input.user_id === self.id) return { status: 400, body: { error: "Tu ne peux pas supprimer ton propre compte." } };
    const response = await fetch(`${authUrl}/${input.user_id}`, { method: "DELETE", headers: serverHeaders() });
    return response.ok ? { status: 200, body: { deleted: true } } : { status: 400, body: { error: "Ce compte n'a pas pu être supprimé." } };
  }
  if (action === "remove-sheet") {
    if (!validTitle(input.title)) return { status: 400, body: { error: "Nom de voiture invalide." } };
    const response = await runRobot("remove-car.yml", input.title);
    if (!response.ok) return { status: 502, body: { error: "Le robot n'a pas pu être lancé." } };
    await fetch(`${SUPABASE_URL}/rest/v1/deck_items?title=eq.${encodeURIComponent(input.title)}`, {
      method: "DELETE",
      headers: serverHeaders(),
    });
    return { status: 200, body: { started: true } };
  }
  return null;
}

Deno.serve(async (request: Request) => {
  const cors = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const reply = ({ status, body }: Answer) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (request.method !== "POST") return reply({ status: 405, body: { error: "Méthode non autorisée." } });
  try {
    const user = await currentUser(request);
    if (!user) return reply({ status: 401, body: { error: "Connexion requise." } });
    const input = await request.json();
    const action = String(input.action ?? "");
    const member = await memberAction(user, action, input);
    if (member) return reply(member);
    if (user.role !== "admin") return reply({ status: 403, body: { error: "Réservé à l'administrateur." } });
    const admin = await adminAction(action, input, user);
    return reply(admin ?? { status: 400, body: { error: "Action inconnue." } });
  } catch (error) {
    console.error(error);
    return reply({ status: 500, body: { error: "Une erreur est survenue." } });
  }
});
