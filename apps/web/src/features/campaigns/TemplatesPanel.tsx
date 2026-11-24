"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmDialog } from "@/lib/confirm";
import { isMediaHeader, type TemplateDto } from "@crm/shared";
import { deleteTemplate, fetchTemplates, setTemplateHeaderMedia, syncTemplates, uploadMedia } from "@/lib/bff";
import { toast } from "@/lib/toast";
import { badge, box, ghostBtn, primaryBtn } from "./styles";
import { TemplateEditor } from "./TemplateEditor";
import { TemplatePreview } from "./TemplatePreview";
import { useHeaderMedia } from "./useHeaderMedia";

const TEMPLATE_STATUS_COLOR: Record<string, string> = {
  APPROVED: "#0a6b42",
  PENDING: "var(--warning)",
  IN_APPEAL: "var(--warning)",
  PENDING_DELETION: "#b3261e",
  REJECTED: "#b3261e",
  PAUSED: "#8a5300",
  DISABLED: "var(--surface-3)",
};

const STATUS_TEXT: Record<string, string> = {
  APPROVED: "Aprobada",
  PENDING: "En revisión",
  IN_APPEAL: "En apelación",
  PENDING_DELETION: "Eliminándose",
  REJECTED: "Rechazada",
  PAUSED: "Pausada",
  DISABLED: "Deshabilitada",
};

const CATEGORY_TEXT: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidad",
  AUTHENTICATION: "Autenticación",
};

export function TemplatesPanel() {
  const queryClient = useQueryClient();
  const { data: templates, isPending } = useQuery({
    queryKey: ["templates"],
    queryFn: fetchTemplates,
  });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["templates"] });

  const remove = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: invalidate,
  });

  const sync = useMutation({
    mutationFn: syncTemplates,
    onSuccess: (r) => {
      toast.success(
        `Sincronizado con Meta: ${r.imported} nueva(s), ${r.updated} actualizada(s).`,
      );
      invalidate();
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <p style={{ color: "var(--muted)", margin: 0, fontSize: 14, maxWidth: 560 }}>
          Plantillas aprobadas por Meta: es lo único que se puede enviar fuera de
          la ventana de 24h. Admiten encabezado con imagen, video, documento o
          ubicación, y botones. Usa <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>…
          para los datos que cambian en cada envío.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => sync.mutate()}
            disabled={sync.isPending}
            style={ghostBtn}
          >
            {sync.isPending ? "Importando…" : "Importar de Meta"}
          </button>
          <button
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
            style={primaryBtn}
          >
            + Nueva plantilla
          </button>
        </div>
      </div>

      {creating && (
        <TemplateEditor
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}

      {isPending && <p style={{ color: "var(--muted)" }}>Cargando…</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(templates ?? []).map((t) =>
          editingId === t.id ? (
            <TemplateEditor
              key={t.id}
              template={t}
              onClose={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null);
                invalidate();
              }}
            />
          ) : (
            <TemplateRow
              key={t.id}
              template={t}
              onEdit={() => {
                setCreating(false);
                setEditingId(t.id);
              }}
              onDelete={() => remove.mutate(t.id)}
            />
          ),
        )}
        {templates && templates.length === 0 && !creating && (
          <p style={{ color: "var(--muted)" }}>
            Aún no hay plantillas. Crea una, o impórtalas si ya las tienes en el
            panel de Meta.
          </p>
        )}
      </div>
    </div>
  );
}

const MEDIA_TEXT = { IMAGE: "Imagen", VIDEO: "Video", DOCUMENT: "Documento" } as const;
const MEDIA_ACCEPT = { IMAGE: "image/jpeg,image/png", VIDEO: "video/mp4", DOCUMENT: "application/pdf,.doc,.docx,.xls,.xlsx" } as const;

/**
 * El archivo del encabezado que sale en los envíos que no eligen uno: flujos,
 * seguimientos, citas y la bienvenida de los formularios. Sin él, Meta los rechaza.
 */
function HeaderMediaField({ template }: { template: TemplateDto }) {
  const queryClient = useQueryClient();
  const picker = useRef<HTMLInputElement>(null);
  const header = isMediaHeader(template.header) ? template.header : null;
  const save = useMutation({
    mutationFn: async (file: File) => setTemplateHeaderMedia(template.id, (await uploadMedia(file)).mediaUrl),
    onSuccess: (t) => {
      queryClient.setQueryData<TemplateDto[]>(["templates"], (old) => old?.map((x) => (x.id === t.id ? t : x)));
      toast.success("Archivo del encabezado guardado.");
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => {
      if (picker.current) picker.current.value = "";
    },
  });
  const { loading } = useHeaderMedia(template);
  if (!header) return null;
  const what = MEDIA_TEXT[header.format];
  return (
    <div className={`tpl-media${header.example || loading ? "" : " is-missing"}`} data-header-media={header.example ? "ok" : "missing"}>
      <span>
        {loading && !header.example
          ? "Trayendo de Meta el archivo del encabezado…"
          : header.example
          ? `${what} del encabezado: lista. Sale en los flujos, seguimientos, citas y bienvenidas que usen esta plantilla.`
          : `Falta ${what.toLowerCase() === "imagen" ? "la imagen" : `el ${what.toLowerCase()}`} del encabezado: los flujos, seguimientos, citas y bienvenidas que usen esta plantilla fallarán. Súbela aquí o pulsa «Importar de Meta».`}
      </span>
      <button type="button" style={ghostBtn} disabled={save.isPending} onClick={() => picker.current?.click()}>
        {save.isPending ? "Subiendo…" : header.example ? "Cambiar" : "Subir"}
      </button>
      <input ref={picker} type="file" hidden accept={MEDIA_ACCEPT[header.format]} aria-label={`${what} del encabezado de ${template.name}`} onChange={(e) => e.target.files?.[0] && save.mutate(e.target.files[0])} />
    </div>
  );
}

function TemplateRow({
  template,
  onEdit,
  onDelete,
}: {
  template: TemplateDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ ...box, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{template.name}</strong>
          <span style={badge("#3f5b6b")}>{template.language}</span>
          <span style={badge("#3f5b6b")}>
            {CATEGORY_TEXT[template.category] ?? template.category}
          </span>
          <span style={badge(TEMPLATE_STATUS_COLOR[template.status] ?? "var(--surface-3)")}>
            {STATUS_TEXT[template.status] ?? template.status}
          </span>
          {template.header && (
            <span style={badge("#3f5b6b")}>Encabezado: {template.header.format}</span>
          )}
          {template.buttons.length > 0 && (
            <span style={badge("#3f5b6b")}>{template.buttons.length} botón(es)</span>
          )}
        </div>

        {template.status === "REJECTED" && template.rejectedReason && (
          <div style={{ color: "var(--danger)", fontSize: 12.5, marginTop: 6 }}>
            Meta la rechazó: {template.rejectedReason}
          </div>
        )}
        {template.status === "PENDING" && (
          <div style={{ color: "var(--muted)", fontSize: 12.5, marginTop: 6 }}>
            Meta la está revisando. Suele tardar unos minutos.
          </div>
        )}

        <div
          style={{
            color: "var(--muted)",
            fontSize: 13,
            marginTop: 6,
            whiteSpace: "pre-wrap",
          }}
        >
          {template.body}
        </div>

        {isMediaHeader(template.header) && <HeaderMediaField template={template} />}

        {open && (
          <div style={{ maxWidth: 320, marginTop: 12 }}>
            <TemplatePreview
              header={template.header}
              body={template.body}
              footer={template.footer}
              buttons={template.buttons}
            />
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          style={{ ...ghostBtn, marginTop: 10 }}
        >
          {open ? "Ocultar vista previa" : "Ver vista previa"}
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!template.readOnly && (
          <button onClick={onEdit} style={ghostBtn}>
            Editar
          </button>
        )}
        <button
          onClick={() => {
            void confirmDialog({
              message: template.waTemplateId
                ? `¿Eliminar "${template.name}"? También se borra en Meta.`
                : `¿Eliminar la plantilla "${template.name}"?`,
              danger: true,
            }).then((ok) => ok && onDelete());
          }}
          style={{ ...ghostBtn, color: "var(--danger)", borderColor: "var(--danger-border)" }}
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}
