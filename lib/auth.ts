import { createHmac, timingSafeEqual } from "crypto";

export type AdminRole = "admin" | "ops" | "tech";

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET environment variable is not set. Refusing to verify tokens " +
      "against a hardcoded fallback secret — that is a security hole, not a default.",
    );
  }
  return secret;
}

// Tokens are issued by BearthApi: base64url(userId:role:timestamp.hmac)
export function verifyToken(token: string): { userId: string; role: AdminRole } | null {
  // Deliberately outside the try/catch below: a missing secret is a
  // misconfiguration that must surface as a real error, not get
  // swallowed into a misleading "invalid token" / 401 response.
  const SECRET = getSecret();
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastDot = decoded.lastIndexOf(".");
    if (lastDot === -1) return null;
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf))
      return null;
    // payload: userId:role:timestamp
    const parts = payload.split(":");
    if (parts.length < 3) return null;
    const [userId, role] = parts;
    if (role !== "admin" && role !== "ops" && role !== "tech") return null;
    return { userId, role: role as AdminRole };
  } catch {
    return null;
  }
}
