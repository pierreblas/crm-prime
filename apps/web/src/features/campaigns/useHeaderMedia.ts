"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isMediaHeader, type TemplateDto } from "@crm/shared";
import { recoverTemplateHeaderMedia } from "@/lib/bff";

/**
 * El archivo del encabezado de una plantilla. Si está en Meta y Driony todavía
 * no lo tiene, lo trae solo: nadie tiene que volver a elegir una imagen que
 * Meta ya aprobó. `loading` mientras lo trae; `media` null si no hay ninguno.
 */
export function useHeaderMedia(template: TemplateDto | null): { media: string | null; loading: boolean } {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState<string | null>(null);
  const [found, setFound] = useState<Record<string, string>>({});
  const tried = useRef(new Set<string>());
  const header = isMediaHeader(template?.header) ? template.header : null;
  const id = template?.id ?? null;
  const missing = !!header && !header.example && !!template?.waTemplateId;

  useEffect(() => {
    if (!id || !missing || tried.current.has(id)) return;
    tried.current.add(id);
    setLoading(id);
    recoverTemplateHeaderMedia(id)
      .then((t) => {
        if (isMediaHeader(t.header) && t.header.example) {
          const example = t.header.example;
          setFound((f) => ({ ...f, [t.id]: example }));
        }
        queryClient.setQueryData<TemplateDto[]>(["templates"], (old) => old?.map((x) => (x.id === t.id ? t : x)));
      })
      .catch(() => undefined)
      .finally(() => setLoading((l) => (l === id ? null : l)));
  }, [id, missing, queryClient]);

  return { media: header ? (header.example ?? (id ? (found[id] ?? null) : null)) : null, loading: !!id && loading === id };
}
