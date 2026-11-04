/**
 * Guard de la consola de plataforma: solo la cuenta maestra.
 *
 *   npm run test:platformguard --workspace=apps/api
 *
 * El cotizador de implementaciones cuelga de este guard, así que aquí se
 * comprueba que un token de usuario de una empresa (sin purpose: "platform")
 * no entra, que el correo tiene que ser el de PLATFORM_ADMIN_EMAIL, y que sin
 * token la respuesta es la misma 401 que cierra la sesión en la web.
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

process.env.TENANCY_MODE = "multi";
process.env.PLATFORM_ADMIN_EMAIL = "ops@driony.test";
process.env.JWT_ACCESS_SECRET = "secreto-de-prueba";

let PlatformAdminGuard: typeof import("../src/modules/platform/platform-admin.guard").PlatformAdminGuard;
let JwtService: typeof import("@nestjs/jwt").JwtService;

before(async () => {
  ({ PlatformAdminGuard } = await import("../src/modules/platform/platform-admin.guard"));
  ({ JwtService } = await import("@nestjs/jwt"));
});

function ctx(authorization?: string) {
  const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any };
}

test("un token de usuario de una empresa no entra en la consola", async () => {
  const jwt = new JwtService({});
  const guard = new PlatformAdminGuard(jwt);
  const tenantToken = await jwt.signAsync({ sub: "u_1", org: "o_1", role: "ADMIN" }, { secret: "secreto-de-prueba" });
  await assert.rejects(() => guard.canActivate(ctx(`Bearer ${tenantToken}`).ctx), (e: any) => e.status === 403);
});

test("un token de plataforma con otro correo tampoco", async () => {
  const jwt = new JwtService({});
  const guard = new PlatformAdminGuard(jwt);
  const other = await jwt.signAsync({ sub: "platform", email: "otro@driony.test", purpose: "platform" }, { secret: "secreto-de-prueba" });
  await assert.rejects(() => guard.canActivate(ctx(`Bearer ${other}`).ctx), (e: any) => e.status === 403);
});

test("un token firmado con otro secreto o sin token: 401 que cierra la sesión", async () => {
  const jwt = new JwtService({});
  const guard = new PlatformAdminGuard(jwt);
  const forged = await jwt.signAsync({ sub: "platform", email: "ops@driony.test", purpose: "platform" }, { secret: "otro-secreto" });
  await assert.rejects(() => guard.canActivate(ctx(`Bearer ${forged}`).ctx), (e: any) => e.status === 401 && e.getResponse().code === "SESSION_EXPIRED");
  await assert.rejects(() => guard.canActivate(ctx().ctx), (e: any) => e.status === 401);
});

test("la cuenta maestra entra y el controlador sabe quién es", async () => {
  const jwt = new JwtService({});
  const guard = new PlatformAdminGuard(jwt);
  const token = await jwt.signAsync({ sub: "platform", email: "ops@driony.test", purpose: "platform" }, { secret: "secreto-de-prueba" });
  const c = ctx(`Bearer ${token}`);
  assert.equal(await guard.canActivate(c.ctx), true);
  assert.equal((c.req as any).platformClaims.email, "ops@driony.test");
});
