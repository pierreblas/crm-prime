"use client";

import { useContext } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { FlowActionsContext } from "./flowShared";

/**
 * Conexión entre bloques. En su punto medio lleva la etiqueta de la rama (si
 * sale de una condición) y dos herramientas: "+" para insertar un bloque en
 * medio y "×" para quitarla. Se muestran al pasar por encima o al
 * seleccionarla (ver .flow-edge-tools en globals.css).
 */
export function FlowEdge(props: EdgeProps) {
  const {
    id,
    source,
    target,
    sourceHandleId,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    markerEnd,
  } = props;
  const actions = useContext(FlowActionsContext);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 14,
  });


  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: selected ? "#6ba2ff" : "#3d5078", strokeWidth: selected ? 2.2 : 1.6 }}
      />
      <EdgeLabelRenderer>
        <div
          className={`nodrag nopan flow-edge-tools${selected ? " is-selected" : ""}`}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <button
            style={btn}
            title="Insertar un bloque aquí"
            onClick={(e) => {
              e.stopPropagation();
              actions?.openAddMenu({
                sourceId: source,
                sourceHandle: sourceHandleId ?? null,
                insertBefore: target,
                anchor: { x: e.clientX, y: e.clientY },
              });
            }}
          >
            +
          </button>
          <button
            style={{ ...btn, color: "#e08a8a" }}
            title="Quitar la conexión"
            onClick={(e) => {
              e.stopPropagation();
              actions?.removeEdge(id);
            }}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { flow: FlowEdge };


const btn: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: "50%",
  border: "1px solid #2b3d5c",
  background: "var(--field)",
  color: "var(--accent-text)",
  fontSize: 14,
  lineHeight: 1,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
};
