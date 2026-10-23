import { createClient } from '@supabase/supabase-js';

let client: ReturnType<typeof createClient> | undefined;

export function browserClient() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

export function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export async function authenticated(request: Request) {
  const token = request.headers
    .get('authorization')
    ?.replace(/^Bearer /, '');

  if (!token) return null;

  const admin = adminClient();

  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) return null;

  const { data: allowed, error: permissionError } = await admin
    .from('allowed_users')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (permissionError) {
    console.error('Tilgangskontroll feilet:', permissionError.message);
    return null;
  }

  return allowed ? data.user : null;
}