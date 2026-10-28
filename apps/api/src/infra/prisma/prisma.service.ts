import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { tenantScopeExtension } from "../tenant/tenant-scope";
import { createRlsExtension, withAtomicTransactions } from "../tenant/rls";
import { createActorExtension } from "../tenant/actor";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * El cliente que recibe toda la aplicación: el de siempre, envuelto en la
 * extensión que filtra por organización.
 *
 * `$extends` devuelve un proxy, no una instancia, así que el tipo se afirma de
 * vuelta a `PrismaService`. El proxy reenvía lo que no conoce al cliente de
 * abajo —incluidos `$connect`, `$transaction` y los hooks de ciclo de vida de
 * Nest—, que es lo que permite mantener la clase como token de inyección y no
 * tocar los 30 servicios que la piden.
 */
export function createPrismaService(): PrismaService {
  const base = new PrismaService();
  const extended = base
    .$extends(tenantScopeExtension)
    .$extends(createRlsExtension(base))
    // La última en añadirse es la primera en correr: firma el autor antes que RLS.
    .$extends(createActorExtension(base));
  return withAtomicTransactions(extended, base) as unknown as PrismaService;
}
