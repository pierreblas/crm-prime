"use client";

import { readableInk } from "@/lib/readable-ink";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchTags, setContactTags } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { NavIcon } from "@/components/NavIcons";
import { useT } from "@/i18n/I18nProvider";

/**
 * Etiquetas de un contacto, editables en el sitio: la × quita, las
 * sugerencias ponen una existente de un toque y escribir un nombre nuevo lo
 * crea. Lo usan la bandeja y el embudo, así que lo que cambia aquí refresca
 * conversaciones, contactos, etiquetas y tablero a la vez.
 */
export function TagEditor({
  contactId,
  applied,
}: {
  contactId: string;
  applied: { name: string; color: string | null }[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const { data: all = [] } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });

  const save = useMutation({
    mutationFn: (names: string[]) => setContactTags(contactId, names),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Mientras se guarda, se enseña ya el resultado: la ida y vuelta al
  // servidor no debe hacer parpadear la lista.
  const names = save.isPending && save.variables ? save.variables : applied.map((x) => x.name);
  const colorOf = (name: string) =>
    applied.find((x) => x.name === name)?.color ?? all.find((x) => x.name === name)?.color ?? null;
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const free = all.filter((x) => !lower.has(x.name.toLowerCase()));
  const suggestions = free.slice(0, 8);
  const listId = `tag-options-${contactId}`;

  function add(name: string) {
    const clean = name.trim();
    setDraft("");
    if (!clean || lower.has(clean.toLowerCase())) return;
    save.mutate([...names, clean]);
  }
  function remove(name: string) {
    save.mutate(names.filter((n) => n !== name));
  }

  return (
    <div className="cp-form">
      {names.length > 0 ? (
        <div className="cp-tags">
          {names.map((name) => (
            <span key={name} className="cp-tag" style={{ background: tagColor(colorOf(name)), color: readableInk(tagColor(colorOf(name))) }}>
              {name}
              <button
                type="button"
                onClick={() => remove(name)}
                disabled={save.isPending}
                title={t("inbox.removeTag", { name })}
                aria-label={t("inbox.removeTag", { name })}
              >
                <NavIcon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="cp-empty">{t("inbox.noTags")}</p>
      )}
      {suggestions.length > 0 && (
        <div className="cp-tags">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="cp-tag cp-tag--add"
              onClick={() => add(s.name)}
              disabled={save.isPending}
            >
              <NavIcon name="plus" size={10} />
              {s.name}
            </button>
          ))}
        </div>
      )}
      <form
        className="cp-row"
        onSubmit={(e) => {
          e.preventDefault();
          add(draft);
        }}
      >
        <input
          className="field field-sm"
          list={listId}
          value={draft}
          maxLength={60}
          placeholder={t("inbox.addTag")}
          aria-label={t("inbox.addTag")}
          title={t("inbox.tagsHint")}
          disabled={save.isPending}
          onChange={(e) => setDraft(e.target.value)}
        />
        <datalist id={listId}>
          {free.map((x) => (
            <option key={x.id} value={x.name} />
          ))}
        </datalist>
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!draft.trim() || save.isPending}>
          {t("inbox.add")}
        </button>
      </form>
    </div>
  );
}

/** Color de fondo de un chip de etiqueta (azul apagado si no tiene). */
export function tagColor(color: string | null): string {
  if (color && /^#?[0-9a-fA-F]{3,8}$/.test(color)) return color.startsWith("#") ? color : `#${color}`;
  return "#2c4b7a";
}
