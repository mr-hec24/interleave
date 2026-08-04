import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Everything requires a session by default, except the public landing page,
  // the auth flow, routes that authenticate themselves another way (cron secret,
  // unsubscribe token), and /explore — which is documentation of the scheduling
  // model: it reads no user data and writes nothing, so gating it behind a login
  // would only stop people reasoning about the algorithm before they sign up.
  const publicPathPrefixes = ["/login", "/auth", "/api/cron", "/unsubscribe", "/explore"];
  const isPublicPath =
    request.nextUrl.pathname === "/" ||
    publicPathPrefixes.some((path) =>
      request.nextUrl.pathname.startsWith(path)
    );

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
