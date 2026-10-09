"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type FinalConnectionState,
  type Connection,
  type Edge,
  type Node,
  type OnBeforeDelete,
  type OnSelectionChangeFunc,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  type CreateFlowInput,
  type FlowAgentRef,
  type FlowBotRef,
  type FlowChannelRef,
  type FlowEdge,
  type FlowNode,
  type FlowNodeData,
  type FlowNodeType,
  type FlowSummary,
} from "@crm/shared";
import { createFlow, fetchFlow, updateFlow } from "@/lib/bff";
import { NavIcon } from "@/components/NavIcons";
import { confirmDialog } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { nodeTypes } from "./FlowNodes";
import {
  TRIGGER_BY_TYPE,
  TRIGGER_META,
  outputsOf,
  PALETTE_GROUPS,
} from "./flowShared";
import { fetchCustomFields, fetchSources, fetchTags, fetchTemplates } from "@/lib/bff";
import { EMPTY_TRIGGER_CONFIG, type FlowTriggerConfig } from "@crm/shared";
import { edgeTypes } from "./FlowEdges";
import { NodeInspector } from "./NodeInspector";
import { FlowAssistant } from "./FlowAssistant";
import {
  DRAG_MIME,
  FlowActionsContext,
  NODE_META,
  NODE_PALETTE,
  defaultNodeData,
  hasDefaultOutput,
  outgoingKey,
  type AddRequest,
  type FlowActions,
} from "./flowShared";
import { autoLayout, collectVariables, computeIssues, findFreeSpot, placeAfter } from "./flowGraph";
import { useFlowHistory, type Snapshot } from "./useFlowHistory";

interface Props {
  flowId: string | null; // null = nuevo
  channels: FlowChannelRef[];
  bots: FlowBotRef[];
  stages: { id: string; name: string }[];
  agents: FlowAgentRef[];
  flows: FlowSummary[];
  onBack: () => void;
}

const EDGE_DEFAULTS = {
  type: "flow",
  markerEnd: { type: MarkerType.ArrowClosed, color: "#3d5078", width: 18, height: 18 },
} as const;

/** El constructor necesita el provider de React Flow para medir y centrar. */
export function FlowBuilder(props: Props) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}

function Builder({ flowId, channels, bots, stages, agents, flows, onBack }: Props) {
  const queryClient = useQueryClient();
  const rf = useReactFlow();
  const isNew = !flowId;

  const { data: loaded } = useQuery({
    queryKey: ["flow", flowId],
    queryFn: () => fetchFlow(flowId!),
    enabled: !isNew,
  });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("Nuevo flujo");
  const [isActive, setIsActive] = useState(false);
  const [triggerType, setTriggerType] = useState<string>("conversation_start");
  const [triggerKeywords, setTriggerKeywords] = useState("");
  const [triggerConfig, setTriggerConfig] = useState<FlowTriggerConfig>(EMPTY_TRIGGER_CONFIG);
  const [channelId, setChannelId] = useState<string | null>(null);
  // Para los selectores del disparador y del bloque «Enviar plantilla».
  const { data: tagList = [] } = useQuery({ queryKey: ["tags"], queryFn: fetchTags });
  const { data: templateList = [] } = useQuery({ queryKey: ["templates"], queryFn: fetchTemplates });
  const { data: customFields = [] } = useQuery({ queryKey: ["custom-fields"], queryFn: fetchCustomFields });
  const { data: sourceList = [] } = useQuery({ queryKey: ["sources"], queryFn: fetchSources });
  const approvedTemplates = templateList.filter((t) => t.status === "APPROVED");
  const trigger = TRIGGER_BY_TYPE[triggerType];
  const setConfig = (p: Partial<FlowTriggerConfig>) => {
    setTriggerConfig((c) => ({ ...c, ...p }));
    markDirty();
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [addMenu, setAddMenu] = useState<AddRequest | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const history = useFlowHistory();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const idCounter = useRef(1);
  const initialized = useRef(false);

  // Estado real del lienzo en el momento de la llamada (sin closures viejos).
  const snap = useCallback((): Snapshot => ({ nodes: rf.getNodes(), edges: rf.getEdges() }), [rf]);
  const markDirty = useCallback(() => setDirty(true), []);
  const newId = () => `n_${Date.now().toString(36)}_${idCounter.current++}`;

  // ── Inicializar: cargar el flujo o sembrar "Inicio" ────────────
  useEffect(() => {
    if (initialized.current) return;
    if (isNew) {
      setNodes([{ id: "start", type: "start", position: { x: 0, y: 0 }, data: {} }]);
      initialized.current = true;
    } else if (loaded) {
      setName(loaded.name);
      setIsActive(loaded.isActive);
      setTriggerType(loaded.triggerType);
      setTriggerKeywords(loaded.triggerKeywords.join(", "));
      setTriggerConfig({ ...EMPTY_TRIGGER_CONFIG, ...(loaded.triggerConfig ?? {}) });
      setChannelId(loaded.channelId);
      setNodes(loaded.nodes as unknown as Node[]);
      setEdges((loaded.edges as unknown as Edge[]).map((e) => ({ ...e, ...EDGE_DEFAULTS })));
      initialized.current = true;
    }
  }, [isNew, loaded, setNodes, setEdges]);

  // ── Piezas ──────────────────────────────────────────────────────
  function makeEdge(source: string, target: string, handle: string | null): Edge {
    return {
      id: `e_${source}_${handle ?? "out"}_${target}`,
      source,
      target,
      sourceHandle: handle,
      label: handle ?? undefined,
      ...EDGE_DEFAULTS,
    };
  }

  function createNode(type: FlowNodeType, position: { x: number; y: number }): Node {
    return { id: newId(), type, position, data: defaultNodeData(type) as Record<string, unknown> };
  }

  /** Selecciona un bloque en React Flow (y por tanto en el inspector). */
  const select = useCallback(
    (id: string | null) => {
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
      setSelectedId(id);
    },
    [setNodes],
  );

  // ── Añadir bloques ──────────────────────────────────────────────
  function addAt(type: FlowNodeType, wanted: { x: number; y: number }) {
    history.record(snap());
    const node = createNode(type, findFreeSpot(rf.getNodes(), wanted));
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setSelectedId(node.id);
    markDirty();
  }

  /** Desde la paleta (clic): en el centro de lo que se ve. */
  function addAtCenter(type: FlowNodeType) {
    const rect = wrapRef.current?.getBoundingClientRect();
    const center = rect
      ? rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 };
    addAt(type, { x: center.x - 110, y: center.y - 40 });
  }

  /** Desde un "+" (salida o conexión): conectado y bien colocado. */
  function addFromRequest(req: AddRequest, type: FlowNodeType) {
    const all = rf.getNodes();
    const source = req.sourceId ? all.find((n) => n.id === req.sourceId) : null;
    if (req.sourceId && !source) return;
    history.record(snap());

    let position: { x: number; y: number };
    if (req.at) {
      position = findFreeSpot(all, { x: req.at.x - 20, y: req.at.y - 16 });
    } else if (!source) {
      position = findFreeSpot(all, { x: 0, y: 0 });
    } else if (req.insertBefore) {
      const target = all.find((n) => n.id === req.insertBefore);
      position = target
        ? findFreeSpot(all, {
            x: (source.position.x + target.position.x) / 2,
            y: (source.position.y + target.position.y) / 2,
          })
        : placeAfter(all, source, req.sourceHandle);
    } else {
      position = placeAfter(all, source, req.sourceHandle);
    }

    const node = createNode(type, position);
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setEdges((eds) => {
      if (!source) return eds;
      // La salida de origen pasa a apuntar al bloque nuevo.
      const next = eds.filter(
        (e) => !(e.source === source.id && (e.sourceHandle ?? null) === (req.sourceHandle ?? null)),
      );
      next.push(makeEdge(source.id, node.id, req.sourceHandle ?? null));
      // Al insertar en medio, el nuevo hereda la conexión hacia el destino por
      // su salida por defecto (o por "en otro caso" si es una condición).
      if (req.insertBefore) {
        const first = outputsOf(type, node.data as FlowNodeData)[0];
        if (first) next.push(makeEdge(node.id, req.insertBefore, first.id));
      }
      return next;
    });
    setSelectedId(node.id);
    markDirty();
  }

  // ── Conectar, quitar, duplicar, borrar ─────────────────────────
  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      history.record(snap());
      setEdges((eds) => {
        // Una salida (nodo + handle) solo puede tener una conexión: reemplaza.
        const filtered = eds.filter(
          (e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)),
        );
        return [...filtered, makeEdge(c.source!, c.target!, c.sourceHandle ?? null)];
      });
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.record, snap, setEdges, markDirty],
  );

  /**
   * Soltar una conexión en el vacío: abre el menú de bloques ahí mismo y el
   * nuevo queda conectado a esa salida. Soltar sobre un bloque ya enlaza por
   * sí solo (todo el bloque es destino mientras se arrastra).
   */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (state.isValid || state.toNode || !state.fromNode || state.fromHandle?.type !== "source") return;
      const pt = "changedTouches" in event ? event.changedTouches[0] : (event as MouseEvent);
      if (!pt) return;
      setAddMenu({
        sourceId: state.fromNode.id,
        sourceHandle: state.fromHandle.id ?? null,
        anchor: { x: pt.clientX, y: pt.clientY },
        at: rf.screenToFlowPosition({ x: pt.clientX, y: pt.clientY }),
      });
    },
    [rf],
  );

  const removeEdge = useCallback(
    (edgeId: string) => {
      history.record(snap());
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.record, snap, setEdges, markDirty],
  );

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const src = rf.getNodes().find((n) => n.id === nodeId);
      if (!src || src.type === "start") return;
      history.record(snap());
      const copy: Node = {
        ...src,
        id: newId(),
        position: findFreeSpot(rf.getNodes(), { x: src.position.x + 40, y: src.position.y + 40 }),
        data: JSON.parse(JSON.stringify(src.data)) as Record<string, unknown>,
        selected: true,
      };
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), copy]);
      setSelectedId(copy.id);
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rf, history.record, snap, setNodes, markDirty],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (nodeId === "start") return;
      history.record(snap());
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId((s) => (s === nodeId ? null : s));
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.record, snap, setNodes, setEdges, markDirty],
  );

  // Supr / Retroceso: React Flow borra la selección; aquí se protege Inicio y
  // se guarda el punto de retorno.
  const onBeforeDelete: OnBeforeDelete = async ({ nodes: del, edges: delEdges }) => {
    const keep = del.filter((n) => n.type !== "start");
    if (!keep.length && !delEdges.length) return false;
    history.record(snap());
    markDirty();
    return { nodes: keep, edges: delEdges };
  };

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: sel }) => {
    setSelectedId(sel[0]?.id ?? null);
  }, []);

  // ── Inspector ──────────────────────────────────────────────────
  function updateNodeData(data: FlowNodeData) {
    if (!selectedId) return;
    history.record(snap(), `data:${selectedId}`);
    setNodes((nds) =>
      nds.map((n) => (n.id === selectedId ? { ...n, data: data as Record<string, unknown> } : n)),
    );
    markDirty();
  }

  // ── Deshacer / rehacer / ordenar ───────────────────────────────
  function undo() {
    const prev = history.undo(snap());
    if (!prev) return;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    markDirty();
  }
  function redo() {
    const next = history.redo(snap());
    if (!next) return;
    setNodes(next.nodes);
    setEdges(next.edges);
    markDirty();
  }
  function tidy() {
    history.record(snap());
    setNodes(autoLayout(rf.getNodes(), rf.getEdges()));
    markDirty();
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1 }));
  }

  // El asistente devuelve el grafo completo: se reemplaza el lienzo entero.
  function applyAssistantProposal(nextNodes: FlowNode[], nextEdges: FlowEdge[]) {
    history.record(snap());
    setNodes(nextNodes as unknown as Node[]);
    setEdges((nextEdges as unknown as Edge[]).map((e) => ({ ...e, ...EDGE_DEFAULTS })));
    setSelectedId(null);
    markDirty();
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 300, maxZoom: 1 }));
  }

  // ── Arrastrar desde la paleta ──────────────────────────────────
  function onDrop(e: React.DragEvent) {
    const type = e.dataTransfer.getData(DRAG_MIME) as FlowNodeType;
    if (!type) return;
    e.preventDefault();
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    addAt(type, { x: p.x - 110, y: p.y - 30 });
  }

  // ── Atajos de teclado ──────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "Escape") {
        setAddMenu(null);
        setIssuesOpen(false);
        return;
      }
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
      else if (k === "s") { e.preventDefault(); save.mutate(); }
      else if (k === "d" && selectedId) { e.preventDefault(); duplicateNode(selectedId); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Derivados ──────────────────────────────────────────────────
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const issues = useMemo(() => computeIssues(nodes, edges), [nodes, edges]);
  const issueList = useMemo(
    () => [...issues.entries()].flatMap(([id, msgs]) => msgs.map((m) => ({ id, m }))),
    [issues],
  );
  const variables = useMemo(() => collectVariables(nodes), [nodes]);

  // El grafo en el formato compartido, que es lo que entiende el asistente.
  const graph = useMemo(
    () => ({
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as FlowNode["type"],
        position: n.position,
        data: n.data as FlowNodeData,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        label: typeof e.label === "string" ? e.label : undefined,
      })) as FlowEdge[],
    }),
    [nodes, edges],
  );

  // Edición en el propio bloque: cada bloque cambia sus datos sin pasar por el inspector.
  const patchNode = useCallback(
    (id: string, patch: Partial<FlowNodeData>) => {
      history.record(snap(), `data:${id}`);
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
      markDirty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.record, snap, setNodes, markDirty],
  );

  const flowActions = useMemo<FlowActions>(() => {
    const taken = new Set(edges.map((e) => outgoingKey(e.source, e.sourceHandle)));
    return {
      openAddMenu: setAddMenu,
      isOutgoingTaken: (sourceId, sourceHandle) => taken.has(outgoingKey(sourceId, sourceHandle)),
      removeEdge,
      duplicateNode,
      deleteNode,
      issuesFor: (id) => issues.get(id) ?? [],
      patchNode,
    };
  }, [edges, removeEdge, duplicateNode, deleteNode, issues, patchNode]);

  // ── Guardar / volver ───────────────────────────────────────────
  const save = useMutation({
    mutationFn: () => {
      const payload: CreateFlowInput = {
        name,
        isActive,
        channelId,
        triggerType: triggerType as CreateFlowInput["triggerType"],
        triggerKeywords: triggerKeywords.split(",").map((k) => k.trim()).filter(Boolean),
        triggerConfig,
        nodes: graph.nodes,
        edges: graph.edges,
      };
      return isNew ? createFlow(payload) : updateFlow(flowId!, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flows"] });
      setDirty(false);
      if (isNew) onBack();
      else toast.success("Flujo guardado");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function trySave() {
    if (isActive && issueList.length) {
      setIssuesOpen(true);
      toast.error("Corrige los avisos antes de activar el flujo, o guárdalo inactivo.");
      return;
    }
    save.mutate();
  }

  async function handleBack() {
    if (dirty) {
      const ok = await confirmDialog({
        title: "Salir sin guardar",
        message: "Hay cambios sin guardar en este flujo. ¿Salir de todos modos?",
        confirmLabel: "Salir",
        cancelLabel: "Seguir editando",
        danger: true,
      });
      if (!ok) return;
    }
    onBack();
  }

  function focusNode(id: string) {
    const n = rf.getNodes().find((x) => x.id === id);
    if (!n) return;
    select(id);
    rf.setCenter(n.position.x + (n.measured?.width ?? 220) / 2, n.position.y + 60, { zoom: 1, duration: 350 });
    setIssuesOpen(false);
  }

  return (
    <div style={{ height: "calc(100vh - 56px)", display: "flex", flexDirection: "column" }}>
      {/* Barra superior */}
      <div style={bar}>
        <button onClick={handleBack} style={{ ...ghost, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <NavIcon name="arrow-left" size={15} />
          Volver
        </button>
        <input
          style={{ ...input, width: 170, fontWeight: 600 }}
          value={name}
          title="Nombre del flujo"
          onChange={(e) => { setName(e.target.value); markDirty(); }}
        />
        <select
          style={{ ...input, width: 210 }}
          value={triggerType}
          title={trigger ? `Cuándo arranca: ${trigger.hint}` : "Disparador: cuándo arranca el flujo"}
          onChange={(e) => { setTriggerType(e.target.value); markDirty(); }}
        >
          {TRIGGER_META.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        {trigger?.needs === "keywords" && (
          <input
            style={{ ...input, width: 160 }}
            value={triggerKeywords}
            placeholder="hola, info, precio"
            title="Palabras clave que disparan el flujo (separadas por comas)"
            onChange={(e) => { setTriggerKeywords(e.target.value); markDirty(); }}
          />
        )}
        {trigger?.needs === "tags" && (
          <>
            <input
              style={{ ...input, width: 180 }}
              list="flow-trigger-tags"
              value={triggerConfig.tags.join(", ")}
              placeholder="cualquier etiqueta"
              title="Solo con estas etiquetas (separadas por comas). Vacío = cualquiera"
              onChange={(e) => setConfig({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
            />
            <datalist id="flow-trigger-tags">
              {tagList.map((t) => <option key={t.id} value={t.name} />)}
            </datalist>
          </>
        )}
        {trigger?.needs === "stages" && (
          <select
            style={{ ...input, width: 170 }}
            value={triggerConfig.stageIds[0] ?? ""}
            title="Solo al entrar en esta etapa. Vacío = cualquier etapa"
            onChange={(e) => setConfig({ stageIds: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">Cualquier etapa</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        {trigger?.needs === "forms" && (
          <input
            style={{ ...input, width: 180 }}
            value={triggerConfig.forms.join(", ")}
            placeholder="cualquier formulario"
            title="Solo estos formularios de Meta, por nombre (separados por comas). Vacío = cualquiera"
            onChange={(e) => setConfig({ forms: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
          />
        )}
        {trigger?.needs === "hours" && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }} title="Horas sin respuesta del cliente desde tu último mensaje">
            tras
            <input
              type="number"
              min={1}
              max={720}
              style={{ ...input, width: 64 }}
              value={triggerConfig.hours}
              onChange={(e) => setConfig({ hours: Math.max(1, Math.min(720, Number(e.target.value) || 24)) })}
            />
            h sin responder
          </label>
        )}
        <select
          style={{ ...input, width: 150 }}
          value={channelId ?? ""}
          title="Número de WhatsApp al que aplica"
          onChange={(e) => { setChannelId(e.target.value || null); markDirty(); }}
        >
          <option value="">Cualquier número</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label ?? c.displayPhoneNumber ?? c.id}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => { setIsActive(e.target.checked); markDirty(); }} />
          Activo
        </label>

        <div style={{ flex: 1 }} />

        <div style={group}>
          <button onClick={undo} disabled={!history.canUndo} style={iconGhost} title="Deshacer (Ctrl+Z)">
            <NavIcon name="reply" size={15} />
          </button>
          <button onClick={redo} disabled={!history.canRedo} style={iconGhost} title="Rehacer (Ctrl+Shift+Z)">
            <span style={{ display: "inline-flex", transform: "scaleX(-1)" }}>
              <NavIcon name="reply" size={15} />
            </span>
          </button>
          <button onClick={tidy} style={iconGhost} title="Ordenar los bloques automáticamente">
            <NavIcon name="pipeline" size={15} />
          </button>
        </div>

        <div style={{ position: "relative" }}>
          <button
            onClick={() => setIssuesOpen((v) => !v)}
            style={issueList.length ? issuesBtnWarn : issuesBtnOk}
            title={issueList.length ? "Cosas que faltan" : "Todo en orden"}
          >
            <NavIcon name={issueList.length ? "alert" : "check"} size={14} />
            {issueList.length ? `${issueList.length} aviso${issueList.length === 1 ? "" : "s"}` : "Sin avisos"}
          </button>
          {issuesOpen && issueList.length > 0 && (
            <div style={issuesMenu}>
              {issueList.map(({ id, m }, i) => (
                <button key={`${id}-${i}`} style={issuesItem} onClick={() => focusNode(id)}>
                  <span style={{ color: "var(--muted)" }}>{NODE_META[nodes.find((n) => n.id === id)?.type ?? ""]?.label ?? id}</span>
                  <span>{m}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setAssistantOpen((v) => !v)}
          style={assistantOpen ? assistantBtnOn : assistantBtnOff}
          title="Armar el flujo con IA"
        >
          <NavIcon name="bot" size={15} />
          Asistente
        </button>
        <button
          onClick={trySave}
          disabled={save.isPending}
          style={{ ...primary, opacity: dirty || isNew ? 1 : 0.75 }}
          title={dirty ? "Hay cambios sin guardar (Ctrl+S)" : "Guardar (Ctrl+S)"}
        >
          {save.isPending ? (
            "Guardando…"
          ) : dirty ? (
            <>
              <span style={dirtyDot} />
              Guardar cambios
            </>
          ) : (
            "Guardar flujo"
          )}
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Paleta */}
        <aside style={palette}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6, lineHeight: 1.4 }}>
            Cada salida es un punto: con «+» está libre (clic para elegir el
            bloque que sigue; arrastra para unirla a otro). Los textos se
            escriben en el propio bloque al seleccionarlo. Doble clic en el
            lienzo añade un bloque suelto.
          </div>
          {PALETTE_GROUPS.map((g) => (
            <div key={g} style={{ display: "contents" }}>
              <div style={paletteGroup}>{g}</div>
              {NODE_PALETTE.filter((p) => p.group === g).map((p) => (
                <button
                  key={p.type}
                  onClick={() => addAtCenter(p.type)}
                  style={paletteBtn}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, p.type);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  title={p.hint}
                >
                  <span style={{ color: p.accent, display: "inline-flex" }}>
                    <NavIcon name={p.icon} size={16} />
                  </span>
                  <span style={{ flex: 1 }}>{p.label}</span>
                </button>
              ))}
            </div>
          ))}
          <div style={{ marginTop: "auto", fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
            Ctrl+Z deshacer · Supr borrar · Ctrl+D duplicar · Ctrl+S guardar
          </div>
        </aside>

        {/* Lienzo */}
        <div
          ref={wrapRef}
          style={{ flex: 1, minWidth: 0, position: "relative" }}
          // Doble clic en el lienzo vacío: añadir un bloque suelto ahí.
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).classList.contains("react-flow__pane")) return;
            setAddMenu({ anchor: { x: e.clientX, y: e.clientY }, at: rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }) });
          }}
          onDrop={onDrop}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
        >
          <FlowActionsContext.Provider value={flowActions}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={(changes) => {
                onNodesChange(changes);
                if (changes.some((c) => c.type === "position" && c.dragging)) markDirty();
              }}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              connectOnClick={false}
              zoomOnDoubleClick={false}
              isValidConnection={(c) => c.source !== c.target}
              connectionRadius={40}
              connectionLineStyle={{ stroke: "var(--accent)", strokeWidth: 2 }}
              onNodeDragStart={() => history.record(snap())}
              onSelectionChange={onSelectionChange}
              onBeforeDelete={onBeforeDelete}
              onPaneClick={() => {
                setAddMenu(null);
                setIssuesOpen(false);
              }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={EDGE_DEFAULTS}
              deleteKeyCode={["Backspace", "Delete"]}
              snapToGrid
              snapGrid={[12, 12]}
              minZoom={0.25}
              maxZoom={1.75}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              colorMode="dark"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#243049" />
              <Controls />
              {/* El minimapa solo ayuda con flujos grandes; en uno pequeño tapa bloques. */}
              {nodes.length >= 8 && (
                <MiniMap
                  pannable
                  zoomable
                  style={{ width: 150, height: 96 }}
                  nodeColor={(n) => NODE_META[n.type ?? ""]?.color ?? "#3a4c6a"}
                  maskColor="rgba(9,13,21,0.7)"
                />
              )}
            </ReactFlow>
          </FlowActionsContext.Provider>
        </div>

        {/* Inspector */}
        {selectedNode && (
          <aside style={inspector}>
            <NodeInspector
              node={selectedNode}
              bots={bots}
              stages={stages}
              templates={approvedTemplates}
              agents={agents}
              fields={customFields}
              tags={tagList}
              sources={sourceList}
              channels={channels}
              flows={flows.filter((f) => f.id !== flowId)}
              variables={variables}
              issues={issues.get(selectedNode.id) ?? []}
              onChange={updateNodeData}
              onDelete={() => deleteNode(selectedNode.id)}
              onDuplicate={() => duplicateNode(selectedNode.id)}
            />
          </aside>
        )}

        {/* Asistente IA */}
        {assistantOpen && (
          <FlowAssistant
            flowId={flowId}
            nodes={graph.nodes}
            edges={graph.edges}
            onApply={applyAssistantProposal}
            onClose={() => setAssistantOpen(false)}
          />
        )}
      </div>

      {/* Menú "+": flota sobre todo, anclado donde se pulsó, sin escalar con el zoom */}
      {addMenu && (
        <AddMenu
          req={addMenu}
          onPick={(type) => {
            addFromRequest(addMenu, type);
            setAddMenu(null);
          }}
          onClose={() => setAddMenu(null)}
        />
      )}
    </div>
  );
}

/** Menú de bloques del "+", con buscador. */
function AddMenu({
  req,
  onPick,
  onClose,
}: {
  req: AddRequest;
  onPick: (type: FlowNodeType) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const items = NODE_PALETTE.filter((p) => {
    const s = q.trim().toLowerCase();
    return !s || p.label.toLowerCase().includes(s) || p.hint.toLowerCase().includes(s);
  });
  const W = 270;
  // Alto real del menú (con todos los bloques no cabe en pantallas bajas):
  // se recorta al viewport y el resto se desplaza con scroll.
  const H = Math.min(window.innerHeight - 16, 70 + NODE_PALETTE.length * 46);
  const left = Math.max(8, Math.min(req.anchor.x - 20, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(req.anchor.y + 10, window.innerHeight - H - 8));

  return (
    <>
      <div style={menuBackdrop} onClick={onClose} />
      <div style={{ ...menu, left, top, width: W, maxHeight: H, overflowY: "auto" }} role="menu">
        <div style={{ fontSize: 11.5, color: "var(--muted)", padding: "4px 6px 6px" }}>
          {req.insertBefore ? "Insertar en medio de la conexión" : req.sourceId ? "Añadir el siguiente bloque" : "Añadir un bloque aquí"}
        </div>
        <input
          autoFocus
          style={{ ...input, width: "100%", marginBottom: 6 }}
          placeholder="Buscar bloque…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && items[0]) onPick(items[0].type);
            if (e.key === "Escape") onClose();
          }}
        />
        {items.map((p) => (
          <button key={p.type} style={menuItem} onClick={() => onPick(p.type)}>
            <span style={{ color: p.accent, display: "inline-flex", width: 18, justifyContent: "center" }}>
              <NavIcon name={p.icon} size={15} />
            </span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
              <span style={{ fontWeight: 600 }}>{p.label}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{p.hint}</span>
            </span>
          </button>
        ))}
        {!items.length && <div style={{ padding: 8, fontSize: 12, color: "var(--muted)" }}>Nada coincide.</div>}
      </div>
    </>
  );
}

// ── Estilos ───────────────────────────────────────────────────

const bar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 16px",
  borderBottom: "1px solid var(--border)",
  flexWrap: "wrap",
};

const palette: React.CSSProperties = {
  width: 220,
  flexShrink: 0,
  borderRight: "1px solid var(--border)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  overflowY: "auto",
};

const inspector: React.CSSProperties = {
  width: 320,
  flexShrink: 0,
  borderLeft: "1px solid var(--border)",
  padding: 16,
  overflowY: "auto",
};

const input: React.CSSProperties = {
  padding: "7px 10px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
  fontSize: 13,
  boxSizing: "border-box",
};


const ghost: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 13,
};

const group: React.CSSProperties = {
  display: "inline-flex",
  border: "1px solid var(--border)",
  borderRadius: 8,
  overflow: "hidden",
};

const iconGhost: React.CSSProperties = {
  width: 34,
  height: 32,
  border: "none",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

// Punto que avisa de cambios sin guardar en el botón principal.
const dirtyDot: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: 999,
  background: "currentColor",
  display: "inline-block",
  marginRight: 7,
  verticalAlign: "middle",
};

const primary: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 16px",
  borderRadius: 7,
  border: "none",
  background: "var(--accent)",
  color: "#f3f8ff",
  fontWeight: 600,
  cursor: "pointer",
};

function assistantBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "7px 12px",
    borderRadius: 7,
    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
    background: active ? "rgba(138,43,226,0.12)" : "transparent",
    color: active ? "var(--accent)" : "var(--text)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  };
}
const assistantBtnOn = assistantBtn(true);
const assistantBtnOff = assistantBtn(false);

const issuesBtnBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 11px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 12.5,
  fontWeight: 600,
};
const issuesBtnOk: React.CSSProperties = {
  ...issuesBtnBase,
  border: "1px solid #1f6f46",
  background: "rgba(63,140,110,0.12)",
  color: "#8fe6c0",
};
const issuesBtnWarn: React.CSSProperties = {
  ...issuesBtnBase,
  border: "1px solid #7a6f4a",
  background: "rgba(224,183,102,0.1)",
  color: "#e0b766",
};

const issuesMenu: React.CSSProperties = {
  position: "absolute",
  top: 38,
  right: 0,
  zIndex: 40,
  width: 340,
  maxHeight: 320,
  overflowY: "auto",
  background: "var(--field)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  padding: 4,
  boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
};

const issuesItem: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  width: "100%",
  padding: "7px 9px",
  borderRadius: 7,
  border: "none",
  background: "transparent",
  color: "#e6edf6",
  fontSize: 12.5,
  cursor: "pointer",
  textAlign: "left",
};

const paletteGroup: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--muted)",
  margin: "8px 0 2px",
};

const paletteBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--panel)",
  color: "var(--text)",
  cursor: "grab",
  fontSize: 13,
  textAlign: "left",
};

const menuBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 60,
};

const menu: React.CSSProperties = {
  position: "fixed",
  zIndex: 61,
  background: "var(--field)",
  border: "1px solid var(--border-strong)",
  borderRadius: 10,
  padding: 6,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  boxShadow: "0 10px 30px rgba(0,0,0,0.55)",
};

const menuItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "7px 8px",
  borderRadius: 7,
  border: "none",
  background: "transparent",
  color: "#e6edf6",
  fontSize: 12.5,
  cursor: "pointer",
  textAlign: "left",
  width: "100%",
};
