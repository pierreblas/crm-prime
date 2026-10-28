"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { COUNTRIES, type AudienceTag, type CampaignAudience } from "@crm/shared";
import { NavIcon } from "@/components/NavIcons";
import { fetchAudienceCount, fetchSources, fetchStages } from "@/lib/bff";

/**
 * A quién le llega la difusión. Siempre solo contactos con permiso. Cada
 * bloque es opcional y se combinan entre sí («y»). El recuento se actualiza
 * al vuelo y lo ve también el resumen (`onCount`).
 */
export function AudienceBuilder({
  value,
  onChange,
  tags,
  onCount,
}: {
  value: CampaignAudience;
  onChange: (v: CampaignAudience) => void;
  tags: AudienceTag[];
  onCount?: (c: { count: number; skippedRecent: number } | null) => void;
}) {
  const set = <K extends keyof CampaignAudience>(k: K, v: CampaignAudience[K]) => onChange({ ...value, [k]: v });
  const toggle = (k: "tags" | "excludeTags" | "stageIds" | "sourceIds" | "countries", id: string) =>
    set(k, value[k].includes(id) ? value[k].filter((x) => x !== id) : [...value[k], id]);

  const { data: stages = [] } = useQuery({ queryKey: ["stages-ref"], queryFn: fetchStages });
  const { data: sources = [] } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });

  // Recuento con un pequeño retardo, para no consultar en cada tecla.
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(t);
  }, [value]);
  const { data: count, isFetching } = useQuery({
    queryKey: ["audience-count", debounced],
    queryFn: () => fetchAudienceCount(debounced),
  });
  useEffect(() => {
    onCount?.(count ? { count: count.count, skippedRecent: count.skippedRecent } : null);
  }, [count, onCount]);

  const [more, setMore] = useState(
    () => !!(value.excludeTags.length || value.stageIds.length || value.sourceIds.length || value.countries.length || value.activity !== "any"),
  );
  const [countryQ, setCountryQ] = useState("");
  const countryList = COUNTRIES.filter((c) => value.countries.includes(c.code) || (countryQ && c.name.toLowerCase().includes(countryQ.toLowerCase()))).slice(0, 12);

  return (
    <div className="aud" data-audience>
      <div className="aud__count" aria-live="polite">
        <strong>{count ? count.count : "…"}</strong>
        <span>
          contacto{count?.count === 1 ? "" : "s"} con permiso
          {count && count.optedIn !== count.count ? ` de ${count.optedIn}` : ""}
          {isFetching ? " · calculando…" : ""}
        </span>
        {!!count?.skippedRecent && <em>{count.skippedRecent} fuera por haber recibido otra difusión hace poco</em>}
      </div>

      {value.contactIds.length > 0 && (
        <div className="aud__picked" data-aud-picked>
          <NavIcon name="pipeline" size={14} />
          <span>
            <span>
              Solo los <strong>{value.contactIds.length}</strong> contacto{value.contactIds.length === 1 ? "" : "s"} elegido{value.contactIds.length === 1 ? "" : "s"} en el embudo
            </span>
            <small>Los demás filtros se aplican además de esto.</small>
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("contactIds", [])}>
            Quitar
          </button>
        </div>
      )}

      <div className="aud__block">
        <div className="aud__head">
          <span>Con estas etiquetas</span>
          {value.tags.length > 1 && (
            <span className="seg aud__seg" role="radiogroup" aria-label="Cómo combinar las etiquetas">
              <button type="button" role="radio" aria-checked={value.tagsMode === "any"} onClick={() => set("tagsMode", "any")}>alguna</button>
              <button type="button" role="radio" aria-checked={value.tagsMode === "all"} onClick={() => set("tagsMode", "all")}>todas</button>
            </span>
          )}
        </div>
        <div className="aud__chips">
          {tags.map((t) => (
            <button key={t.id} type="button" className={`aud__chip${value.tags.includes(t.id) ? " is-on" : ""}`} onClick={() => toggle("tags", t.id)} aria-pressed={value.tags.includes(t.id)}>
              {t.name} <small>{t.contactCount}</small>
            </button>
          ))}
          {tags.length === 0 && <span className="aud__hint">No hay etiquetas: se enviará a todos los contactos con permiso que cumplan el resto.</span>}
        </div>
        {value.tags.length === 0 && tags.length > 0 && <span className="aud__hint">Sin elegir ninguna: todos los contactos con permiso.</span>}
      </div>

      <div className="aud__block">
        <label className="aud__check">
          <input
            type="checkbox"
            checked={value.skipRecentDays !== null}
            onChange={(e) => set("skipRecentDays", e.target.checked ? 7 : null)}
          />
          <span>
            No repetir: dejar fuera a quien recibió otra difusión en los últimos
            <input
              className="field field-sm aud__num"
              type="number"
              min={1}
              max={90}
              value={value.skipRecentDays ?? 7}
              disabled={value.skipRecentDays === null}
              onChange={(e) => set("skipRecentDays", Math.min(90, Math.max(1, Number(e.target.value) || 1)))}
              aria-label="Días sin repetir"
            />
            días
          </span>
        </label>
        <span className="aud__hint">Recomendado: demasiados mensajes de marketing bajan la calidad de tu número en WhatsApp.</span>
      </div>

      <button type="button" className="aud__more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
        <NavIcon name="target" size={13} /> {more ? "Menos filtros" : "Más filtros: excluir etiquetas, etapa, fuente, país, actividad"}
      </button>

      {more && (
        <>
          <div className="aud__block">
            <div className="aud__head"><span>Sin estas etiquetas</span></div>
            <div className="aud__chips">
              {tags.map((t) => (
                <button key={t.id} type="button" className={`aud__chip is-ex${value.excludeTags.includes(t.id) ? " is-on" : ""}`} onClick={() => toggle("excludeTags", t.id)} aria-pressed={value.excludeTags.includes(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="aud__block">
            <div className="aud__head"><span>Con una oportunidad abierta en</span></div>
            <div className="aud__chips">
              {stages.map((s) => (
                <button key={s.id} type="button" className={`aud__chip${value.stageIds.includes(s.id) ? " is-on" : ""}`} onClick={() => toggle("stageIds", s.id)} aria-pressed={value.stageIds.includes(s.id)}>
                  {s.pipelineName} › {s.name}
                </button>
              ))}
            </div>
          </div>

          <div className="aud__block">
            <div className="aud__head"><span>Fuente</span></div>
            <div className="aud__chips">
              {sources.map((s) => (
                <button key={s.id} type="button" className={`aud__chip${value.sourceIds.includes(s.id) ? " is-on" : ""}`} onClick={() => toggle("sourceIds", s.id)} aria-pressed={value.sourceIds.includes(s.id)}>
                  {s.name}
                </button>
              ))}
              <button type="button" className={`aud__chip${value.sourceIds.includes("none") ? " is-on" : ""}`} onClick={() => toggle("sourceIds", "none")} aria-pressed={value.sourceIds.includes("none")}>
                Sin fuente
              </button>
            </div>
          </div>

          <div className="aud__block">
            <div className="aud__head"><span>País (por el prefijo del teléfono)</span></div>
            <div className="aud__chips">
              {countryList.map((c) => (
                <button key={c.code} type="button" className={`aud__chip${value.countries.includes(c.code) ? " is-on" : ""}`} onClick={() => toggle("countries", c.code)} aria-pressed={value.countries.includes(c.code)}>
                  {c.name}
                </button>
              ))}
              <input className="field field-sm" style={{ maxWidth: 200 }} placeholder="Buscar país…" value={countryQ} onChange={(e) => setCountryQ(e.target.value)} aria-label="Buscar país" />
            </div>
          </div>

          <div className="aud__block">
            <div className="aud__head"><span>Actividad</span></div>
            <div className="aud__row">
              <select className="field field-sm" style={{ width: "auto" }} value={value.activity} onChange={(e) => set("activity", e.target.value as CampaignAudience["activity"])} aria-label="Actividad">
                <option value="any">Cualquiera</option>
                <option value="within">Escribió en los últimos</option>
                <option value="older">Lleva sin escribir más de</option>
              </select>
              {value.activity !== "any" && (
                <>
                  <input className="field field-sm aud__num" type="number" min={1} max={365} value={value.activityDays} onChange={(e) => set("activityDays", Math.min(365, Math.max(1, Number(e.target.value) || 1)))} aria-label="Días" />
                  <span>días</span>
                </>
              )}
            </div>
            {value.activity === "within" && <span className="aud__hint">Con la ventana de 24 h abierta podrías escribirles sin plantilla, pero la difusión siempre usa plantilla.</span>}
          </div>
        </>
      )}
    </div>
  );
}
