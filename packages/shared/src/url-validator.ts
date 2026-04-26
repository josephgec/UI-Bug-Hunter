import { isIP } from "node:net";
import dns from "node:dns/promises";

export type UrlValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: UrlRejectionReason; detail?: string };

export type UrlRejectionReason =
  | "invalid_url"
  | "disallowed_protocol"
  | "private_ip"
  | "private_ip_resolved"
  | "metadata_ip"
  | "dns_failed";

const PRIVATE_V4: RegExp[] = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^127\./,
  /^169\.254\./, // link-local (incl. 169.254.169.254 metadata)
  /^0\./,
  /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./, // RFC6598 carrier-grade NAT
];

// Cloud metadata endpoints we explicitly call out so the rejection reason is
// useful in logs. 169.254.169.254 is AWS/GCP/Azure IMDS; fd00:ec2::254 is AWS
// IMDS over IPv6.
const METADATA_IPS = new Set(["169.254.169.254", "fd00:ec2::254"]);

function isPrivateIp(ip: string): boolean {
  if (METADATA_IPS.has(ip.toLowerCase())) return true;
  if (PRIVATE_V4.some((re) => re.test(ip))) return true;

  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:")) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique-local

  if (lower.startsWith("::ffff:")) {
    const mapped = lower.split(":").pop();
    if (mapped && PRIVATE_V4.some((re) => re.test(mapped))) return true;
  }
  return false;
}

export async function validateScanUrl(input: string): Promise<UrlValidationResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "disallowed_protocol", detail: url.protocol };
  }

  const hostname = url.hostname;
  if (isIP(hostname)) {
    if (METADATA_IPS.has(hostname.toLowerCase())) {
      return { ok: false, reason: "metadata_ip", detail: hostname };
    }
    if (isPrivateIp(hostname)) {
      return { ok: false, reason: "private_ip", detail: hostname };
    }
    return { ok: true, url };
  }

  // Resolve and reject if any A/AAAA record points at private space. The
  // sandbox-side egress proxy is the actual enforcement point — this is a
  // pre-flight so we fail fast before queueing.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "dns_failed", detail: hostname };
  }

  for (const a of addrs) {
    if (METADATA_IPS.has(a.address.toLowerCase())) {
      return { ok: false, reason: "metadata_ip", detail: a.address };
    }
    if (isPrivateIp(a.address)) {
      return { ok: false, reason: "private_ip_resolved", detail: a.address };
    }
  }

  return { ok: true, url };
}
