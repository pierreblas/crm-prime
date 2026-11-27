import { Global, Logger, Module } from "@nestjs/common";
import { STORAGE_PROVIDER, type StorageProvider } from "./storage.provider";
import { storageConfig, type StorageConfig } from "./storage.config";
import { LocalStorageProvider } from "./providers/local-storage.provider";
import { S3ObjectStore } from "./providers/s3-object-store";
import { S3StorageProvider } from "./providers/s3-storage.provider";

/** El almacén externo de una configuración ya comprobada, con el disco de respaldo. */
export function s3Storage(config: Extract<StorageConfig, { driver: "s3" }>, local: LocalStorageProvider): S3StorageProvider {
  return new S3StorageProvider(new S3ObjectStore(config), local, { prefix: config.prefix, target: `${config.label} · ${config.bucket}` });
}

/**
 * Elige dónde se guardan los archivos según STORAGE_DRIVER: el disco del
 * servidor (por defecto) o un almacén compatible con S3 (Cloudflare R2…).
 *
 * Una configuración a medias no tumba el CRM: se sigue en el disco, se dice en
 * el log y la consola de la plataforma lo enseña en «Salud».
 */
export function createStorage(local: LocalStorageProvider, env: Record<string, string | undefined> = process.env): StorageProvider {
  const logger = new Logger("Storage");
  let config: StorageConfig;
  try {
    config = storageConfig(env);
  } catch (e) {
    const message = (e as Error).message;
    logger.error(`${message}\nLos archivos se siguen guardando en el disco del servidor hasta que se corrija.`);
    local.notice = `${message.replace(/\n\s*- /g, " · ").replace(/:\s·/, ":")} Mientras tanto se usa el disco del servidor.`;
    return local;
  }
  if (config.driver === "local") return local;

  const provider = s3Storage(config, local);
  // Sin esperar: el arranque no depende de que el almacén responda.
  void provider.check().then((error) => {
    if (error) logger.error(`${config.label} (bucket ${config.bucket}) no responde: ${error}. Los archivos nuevos se guardan en el disco hasta que se arregle.`);
    else logger.log(`Los archivos se guardan en ${config.label}, bucket ${config.bucket}${config.prefix ? `, carpeta ${config.prefix}` : ""}`);
  });
  return provider;
}

/** Expone STORAGE_PROVIDER: lo que usa todo el CRM para guardar, leer y borrar archivos. */
@Global()
@Module({
  providers: [
    LocalStorageProvider,
    { provide: STORAGE_PROVIDER, inject: [LocalStorageProvider], useFactory: (local: LocalStorageProvider) => createStorage(local) },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
