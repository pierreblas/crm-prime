import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { EMAIL_SMTP_PORTS } from "@crm/shared";
import { tenancyMode } from "../../infra/tenant/tenant.context";

/**
 * A qué servidores SMTP puede conectarse la API.
 *
 * El servidor de salida lo escribe un administrador de la empresa y la conexión
 * la abre la API desde su propia red: sin estas reglas, cualquiera podría usar
 * «conectar buzón» para sondear direcciones internas. En SaaS solo valen nombres
 * de host públicos, en los puertos de envío autenticado, y la conexión se abre
 * contra la IP que se comprobó (no se vuelve a resolver el nombre). En una
 * instalación propia el servidor es de la empresa y vale lo que configure, un
 * relay interno incluido.
 */

const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home\.arpa)$/i;

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // enlace local y metadatos de nube
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multidifusión y reservadas
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateV4(mapped[1]!);
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
}

export function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 4 ? isPrivateV4(ip) : isPrivateV6(ip);
}

/** Por qué no se admite ese servidor y puerto, o null si vale. Se aplica al guardar y al conectar. */
export function smtpTargetProblem(host: string, port: number): string | null {
  if (tenancyMode !== "multi") return null;
  const h = host.trim().toLowerCase();
  if (isIP(h)) return "escribe el nombre del servidor (smtp.tuproveedor.com), no una dirección IP";
  if (PRIVATE_NAME.test(h) || !h.includes(".")) return "ese servidor no es una dirección pública";
  if (!(EMAIL_SMTP_PORTS as readonly number[]).includes(port)) {
    return `el puerto debe ser ${EMAIL_SMTP_PORTS.slice(0, -1).join(", ")} o ${EMAIL_SMTP_PORTS.at(-1)}`;
  }
  return null;
}

/**
 * La dirección a la que conectar. En SaaS resuelve el nombre, exige que TODAS
 * sus direcciones sean públicas y devuelve una de ellas, para conectar a lo que
 * se comprobó. En una instalación propia devuelve el nombre tal cual.
 */
export async function resolveSmtpHost(host: string): Promise<string> {
  if (tenancyMode !== "multi") return host;
  let found: { address: string; family: number }[];
  try {
    found = await lookup(host, { all: true });
  } catch {
    throw new Error(`no se encontró el servidor ${host}: revisa que esté bien escrito`);
  }
  if (!found.length) throw new Error(`no se encontró el servidor ${host}`);
  if (found.some((a) => isPrivateAddress(a.address))) {
    throw new Error("ese servidor apunta a una dirección interna y no se admite");
  }
  return (found.find((a) => a.family === 4) ?? found[0]!).address;
}
