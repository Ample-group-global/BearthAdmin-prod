import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.BEARTH_API_URL!;

export function getSessionToken(req: NextRequest): string | null {
  return req.cookies.get("admin_session")?.value ?? null;
}

type ProxyOptions = {
  method?: string;
  body?: unknown;
  searchParams?: URLSearchParams;
};

export async function proxyToApi(
  req: NextRequest,
  path: string,
  options: ProxyOptions = {}
): Promise<NextResponse> {
  const token = getSessionToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(path, API_BASE);
  if (options.searchParams) {
    options.searchParams.forEach((v, k) => url.searchParams.set(k, v));
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    // fetch() itself threw -- the backend is genuinely unreachable (connection refused, DNS, etc.)
    return NextResponse.json({ error: "API unreachable" }, { status: 503 });
  }

  // The backend responded, but not necessarily with JSON (e.g. a 404 for an
  // unmounted route returns Express's default HTML error page). Parsing that
  // as JSON used to throw here and get reported as "API unreachable" -- hiding
  // the real status/reason behind a misleading "backend is down" message.
  const text = await response.text();
  try {
    const data = text ? JSON.parse(text) : {};
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: `Backend returned ${response.status} with a non-JSON body`, detail: text.slice(0, 300) },
      { status: response.status },
    );
  }
}
