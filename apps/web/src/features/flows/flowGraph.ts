import type { Edge, Node } from "@xyflow/react";
import type { FlowNodeData } from "@crm/shared";
import { outputsOf, rulesOf } from "./flowShared";

// Tamaño por defecto de un bloque hasta que React Flow lo mide.
export const NODE_W = 220;
export const NODE_H = 90;

export function sizeOf(n: Node): { w: number; h: number } {
  return { w: n.measured?.width ?? NODE_W, h: n.measured?.height ?? NODE_H };
}

/** Un sitio libre cerca de `wanted`: baja hasta no pisar ningún bloque. */
export function findFreeSpot(
  nodes: Node[],
  wanted: { x: number; y: number },
  size = { w: NODE_W, h: NODE_H },
): { x: number; y: number } {
  const pos = { ...wanted };
  const margin = 24;
  for (let i = 0; i < 30; i++) {
    const hit = nodes.some((n) => {
      const s = sizeOf(n);
      return (
        pos.x < n.position.x + s.w + margin &&
        pos.x + size.w + margin > n.position.x &&
        pos.y < n.position.y + s.h + margin &&
        pos.y + size.h + margin > n.position.y
      );
    });
    if (!hit) return pos;
    pos.y += 48;
  }
  return pos;
}

/**
 * Dónde poner el bloque que sigue a una salida: debajo del bloque, o a su
 * derecha y a la altura de la rama si la salida es una rama de condición.
 */
export function placeAfter(
  nodes: Node[],
  source: Node,
  sourceHandle?: string | null,
): { x: number; y: number } {
  const { w, h } = sizeOf(source);
  if (sourceHandle) {
    const outs = outputsOf(source.type, source.data as FlowNodeData);
    const idx = Math.max(0, outs.findIndex((o) => o.id === sourceHandle));
    return findFreeSpot(nodes, {
      x: source.position.x + w + 90,
      y: source.position.y + idx * 110,
    });
  }
  return findFreeSpot(nodes, { x: source.position.x, y: source.position.y + h + 70 });
}

/**
 * Ordena el lienzo por niveles desde Inicio: cada bloque debajo del que lo
 * precede, los hermanos en fila y centrados bajo su padre. Sin dependencias:
 * los flujos son árboles pequeños y esto basta.
 */
export function autoLayout(nodes: Node[], edges: Edge[]): Node[] {
  const start = nodes.find((n) => n.type === "start") ?? nodes[0];
  if (!start) return nodes;

  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e.target);
  }

  // Nivel = camino más largo desde Inicio (con tope, por si hay ciclos).
  const level = new Map<string, number>([[start.id, 0]]);
  const queue = [start.id];
  const cap = nodes.length + 1;
  while (queue.length) {
    const id = queue.shift()!;
    const next = (level.get(id) ?? 0) + 1;
    for (const t of out.get(id) ?? []) {
      if ((level.get(t) ?? -1) < next && next < cap) {
        level.set(t, next);
        queue.push(t);
      }
    }
  }
  let maxLevel = Math.max(0, ...level.values());
  // Lo que no cuelga de Inicio va en una fila propia, al final.
  const sueltos = nodes.filter((n) => !level.has(n.id));
  if (sueltos.length) {
    maxLevel += 1;
    for (const n of sueltos) level.set(n.id, maxLevel);
  }

  const rows = new Map<number, Node[]>();
  for (const n of nodes) {
    const l = level.get(n.id)!;
    if (!rows.has(l)) rows.set(l, []);
    rows.get(l)!.push(n);
  }

  const GAP_X = 60;
  const GAP_Y = 90;
  const pos = new Map<string, { x: number; y: number }>();
  let y = 0;
  for (let l = 0; l <= maxLevel; l++) {
    const row = rows.get(l) ?? [];
    if (!row.length) continue;
    // Cada bloque bajo la media de sus padres; los que no tienen, por su x actual.
    const key = (n: Node) => {
      const parents = edges.filter((e) => e.target === n.id && pos.has(e.source));
      if (!parents.length) return n.position.x;
      return parents.reduce((s, e) => s + pos.get(e.source)!.x, 0) / parents.length;
    };
    row.sort((a, b) => key(a) - key(b));
    const totalW = row.reduce((s, n) => s + sizeOf(n).w, 0) + GAP_X * (row.length - 1);
    let x = -totalW / 2;
    let rowH = 0;
    for (const n of row) {
      const { w, h } = sizeOf(n);
      pos.set(n.id, { x, y });
      x += w + GAP_X;
      rowH = Math.max(rowH, h);
    }
    y += rowH + GAP_Y;
  }
  return nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
}

/** Variables que define el flujo: las preguntas y las respuestas HTTP guardadas. */
export function collectVariables(nodes: Node[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    const d = n.data as FlowNodeData;
    if ((n.type === "askQuestion" || n.type === "buttons") && d.variable) out.add(d.variable);
    if (n.type === "http" && d.saveAs) out.add(d.saveAs);
  }
  return [...out];
}

/** Avisos por bloque: lo que impediría que el flujo funcione como se espera. */
export function computeIssues(nodes: Node[], edges: Edge[]): Map<string, string[]> {
  const issues = new Map<string, string[]>();
  const add = (id: string, msg: string) => issues.set(id, [...(issues.get(id) ?? []), msg]);

  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source)!.push(e.target);
  }
  const reachable = new Set<string>();
  const stack = ["start"];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const t of out.get(id) ?? []) stack.push(t);
  }
  if (nodes.length > 1 && !edges.some((e) => e.source === "start")) {
    add("start", "Inicio no está conectado a ningún bloque");
  }

  for (const n of nodes) {
    if (n.type === "start") continue;
    const d = n.data as FlowNodeData;
    if (!reachable.has(n.id)) add(n.id, "No se llega a este bloque desde Inicio");
    switch (n.type) {
      case "sendMessage":
        if (!d.text?.trim()) add(n.id, "Falta el texto del mensaje");
        break;
      case "list": {
        const rows = (d.buttons ?? []).filter((b) => b.title.trim());
        if (rows.length === 0) add(n.id, "La lista necesita al menos una opción con título");
        if ((d.buttons ?? []).some((b) => !b.title.trim())) add(n.id, "Hay opciones sin título");
        break;
      }
      case "carousel": {
        const cards = d.cards ?? [];
        if (cards.length < 2) add(n.id, "El carrusel necesita al menos 2 tarjetas");
        if (cards.some((c) => !c.mediaUrl)) add(n.id, "Cada tarjeta necesita una imagen o un video");
        if (d.cardMode === "url" && cards.some((c) => !/^https?:\/\/\S+\.\S+/.test(c.url ?? ""))) add(n.id, "Cada tarjeta necesita un enlace (https://…)");
        break;
      }
      case "sendTemplate":
        if (!d.templateId) add(n.id, "Elige una plantilla aprobada");
        break;
      case "askQuestion":
        if (!d.text?.trim()) add(n.id, "Falta la pregunta");
        if (!d.variable) add(n.id, "Falta la variable donde guardar la respuesta");
        if (d.validate === "regex") {
          if (!d.pattern?.trim()) add(n.id, "Falta el patrón (regex)");
          else {
            try {
              new RegExp(d.pattern);
            } catch {
              add(n.id, "El patrón no es una expresión regular válida");
            }
          }
        }
        break;
      case "buttons": {
        const titles = (d.buttons ?? []).map((b) => b.title.trim()).filter(Boolean);
        if (!titles.length) add(n.id, "Añade al menos un botón");
        if ((d.buttons ?? []).some((b) => b.title.length > 20)) add(n.id, "Los botones admiten 20 caracteres como máximo");
        if (new Set(titles.map((t) => t.toLowerCase())).size !== titles.length) add(n.id, "Hay botones repetidos");
        break;
      }
      case "setField":
        if (!d.fieldKey?.trim()) add(n.id, "Elige el campo a guardar");
        break;
      case "addNote":
        if (!d.text?.trim()) add(n.id, "Falta el texto de la nota");
        break;
      case "setStatus":
        if (!d.status) add(n.id, "Elige el estado");
        break;
      case "split": {
        const splits = d.splits ?? [];
        if (splits.length < 2) add(n.id, "Añade al menos dos variantes");
        if (!splits.some((s) => s.weight > 0)) add(n.id, "Algún peso debe ser mayor que 0");
        break;
      }
      case "schedule":
        if (!d.hours || !Object.values(d.hours.days ?? {}).some(Boolean)) add(n.id, "Marca al menos un día con horario");
        if (!edges.some((e) => e.source === n.id && e.sourceHandle === "out")) add(n.id, "Conecta la salida «fuera de horario»");
        break;
      case "condition":
        if (!d.branches?.length) add(n.id, "La condición no tiene ramas");
        else {
          if (d.branches.some((b) => !rulesOf(b).length)) add(n.id, "Hay ramas sin condiciones");
          const needValue = (r: { op: string; value?: string }) => !["empty", "not_empty"].includes(r.op) && !r.value?.trim();
          if (d.branches.some((b) => rulesOf(b).some(needValue))) add(n.id, "Hay condiciones sin valor");
          if (d.branches.some((b) => rulesOf(b).some((r) => (r.field === "variable" || r.field === "contact_field") && !r.key))) {
            add(n.id, "Elige la variable o el campo en la condición");
          }
        }
        break;
      case "action":
        if ((d.action === "tag" || d.action === "untag") && !d.tag?.trim()) add(n.id, "Falta la etiqueta");
        if ((d.action === "move_deal" || d.action === "create_deal") && !d.stageId) add(n.id, "Falta la etapa del embudo");
        break;
      case "http":
        if (!d.url?.trim()) add(n.id, "Falta la URL");
        else if (d.headers?.trim()) {
          try {
            JSON.parse(d.headers);
          } catch {
            add(n.id, "Las cabeceras no son JSON válido");
          }
        }
        break;
      case "assign":
        if (!d.agentId) add(n.id, "Falta el agente");
        break;
      case "jumpToFlow":
        if (!d.flowId) add(n.id, "Falta el flujo de destino");
        break;
      case "delay":
        if (!d.delayValue || d.delayValue < 1) add(n.id, "El tiempo de espera debe ser mayor que 0");
        break;
    }
  }
  return issues;
}
