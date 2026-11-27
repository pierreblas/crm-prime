/**
 * El almacén de archivos, desde la terminal.
 *
 *   check                     comprueba la configuración y que el almacén responde
 *   migrate                   sube al almacén lo que hay en el disco del servidor
 *   migrate --delete-local    y borra del disco cada archivo al comprobar que subió
 *
 * En producción, dentro del contenedor de la API:
 *   docker compose -f docker-compose.prod.yml exec api node dist/scripts/storage.js check
 * En desarrollo:
 *   npm run storage --workspace=apps/api -- check
 *
 * Nunca imprime la clave secreta.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { describeConfig, storageConfig, StorageConfigError, type StorageConfig } from "../infra/storage/storage.config";
import { humanBytes, migrateToBucket } from "../infra/storage/storage.migrate";
import { s3Storage } from "../infra/storage/storage.module";
import { LocalStorageProvider } from "../infra/storage/providers/local-storage.provider";
import { explainStoreError, S3ObjectStore } from "../infra/storage/providers/s3-object-store";
import { decodeName, encodeName } from "../infra/storage/providers/s3-storage.provider";

const RUN = "node dist/scripts/storage.js";

// En desarrollo las variables están en el .env; en producción ya vienen del compose (y no se pisan).
for (const file of ["../../.env", ".env"]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
}

function readConfig(): StorageConfig | null {
  try {
    return storageConfig();
  } catch (e) {
    console.error(e instanceof StorageConfigError ? e.message : String(e));
    return null;
  }
}

async function check(): Promise<number> {
  const config = readConfig();
  if (!config) return 1;
  for (const line of describeConfig(config)) console.log(line);
  const onDisk = await new LocalStorageProvider()
    .ids()
    .then((ids) => ids.length)
    .catch(() => null);

  if (config.driver === "local") {
    console.log(`\nLos archivos se guardan en el disco del servidor${onDisk !== null ? ` (hay ${onDisk})` : ""}.`);
    console.log("Para usar Cloudflare R2: pon STORAGE_DRIVER=s3 y las variables S3_… en el .env y vuelve a levantar la API.");
    return 1;
  }

  const store = new S3ObjectStore(config);
  const key = `${config.prefix}_driony-check-${randomUUID()}`;
  const body = Buffer.from(`Comprobación de Driony, ${new Date().toISOString()}`);
  const name = "comprobación.txt";
  const step = async (label: string, run: () => Promise<void>): Promise<void> => {
    process.stdout.write(`  ${label}… `);
    await run();
    console.log("bien");
  };
  console.log("");
  try {
    await step("Guardar un archivo de prueba", () => store.put(key, body, "text/plain", { name: encodeName(name) }));
    await step("Leerlo", async () => {
      const obj = await store.get(key);
      if (!obj || !obj.body.equals(body)) throw new Error("lo que se lee no es lo que se guardó");
      if (decodeName(obj.metadata.name) !== name) throw new Error("el nombre del archivo no vuelve igual");
    });
    await step("Borrarlo", async () => {
      await store.delete(key);
      if (await store.head(key)) throw new Error("sigue ahí después de borrarlo");
    });
  } catch (e) {
    console.log("FALLÓ");
    console.error(`\n${explainStoreError(e)}`);
    await store.delete(key).catch(() => undefined);
    return 1;
  }
  console.log(`\nCorrecto: ${config.label} responde y el token puede guardar, leer y borrar en «${config.bucket}».`);
  if (onDisk) {
    console.log(`En el disco del servidor hay ${onDisk} archivos. Se siguen viendo desde el CRM; para subirlos: ${RUN} migrate`);
  }
  return 0;
}

async function migrate(deleteLocal: boolean): Promise<number> {
  const config = readConfig();
  if (!config) return 1;
  if (config.driver === "local") {
    console.error("STORAGE_DRIVER no está en «s3»: no hay almacén al que subir. Configúralo y pasa antes «check».");
    return 1;
  }
  const local = new LocalStorageProvider();
  const target = s3Storage(config, local);
  const down = await target.check();
  if (down) {
    console.error(`${config.label} no responde: ${down}\nNo se ha subido nada.`);
    return 1;
  }

  console.log(`Subiendo a ${config.label} · ${config.bucket} lo que hay en el disco del servidor${deleteLocal ? " (y borrándolo del disco al comprobarlo)" : ""}…`);
  let shown = 0;
  const result = await migrateToBucket(local, target, {
    deleteLocal,
    onProgress: (done, total) => {
      if (done === total || Date.now() - shown > 3000) {
        shown = Date.now();
        console.log(`  ${done} de ${total}`);
      }
    },
  });

  console.log(`\nEn el disco había ${result.total} archivos.`);
  console.log(`  Subidos ahora: ${result.copied} (${humanBytes(result.bytes)})`);
  console.log(`  Ya estaban arriba: ${result.already}`);
  if (deleteLocal) console.log(`  Borrados del disco: ${result.deleted}`);
  if (result.failed.length) {
    console.log(`  No se pudieron subir: ${result.failed.length}`);
    for (const f of result.failed.slice(0, 10)) console.log(`    ${f.id}: ${f.error}`);
    if (result.failed.length > 10) console.log(`    … y ${result.failed.length - 10} más`);
    console.log("\nLos que fallaron siguen en el disco y se siguen viendo. Vuelve a lanzar el traslado: no repite lo que ya subió.");
    return 1;
  }
  if (!deleteLocal && result.total > 0) {
    console.log(`\nTodo está arriba. Los archivos siguen también en el disco; para liberarlo: ${RUN} migrate --delete-local`);
  }
  return 0;
}

async function main(): Promise<number> {
  const [command, ...flags] = process.argv.slice(2);
  if (command === "check") return check();
  if (command === "migrate") return migrate(flags.includes("--delete-local"));
  console.log(`Uso:\n  ${RUN} check                    comprueba la configuración y que el almacén responde\n  ${RUN} migrate                  sube al almacén lo que hay en el disco\n  ${RUN} migrate --delete-local   y borra del disco lo que ya subió`);
  return command ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
