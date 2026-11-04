"use client";

// Evalúa de forma heurística la fortaleza de una contraseña (0–4) sin
// dependencias externas. Suma puntos por longitud y variedad de caracteres y
// penaliza patrones obvios. Solo orientativo para el usuario; la validación
// real (mín. 8) vive en el schema de Zod.
export function scorePassword(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  // Penaliza repeticiones o secuencias triviales.
  if (/(.)\1{2,}/.test(pw) || /1234|abcd|qwerty|password/i.test(pw)) score--;
  return Math.max(0, Math.min(4, score));
}

const LEVELS = [
  { label: "Muy débil", color: "var(--danger)" },
  { label: "Débil", color: "var(--danger)" },
  { label: "Aceptable", color: "var(--warning)" },
  { label: "Buena", color: "var(--positive)" },
  { label: "Fuerte", color: "var(--accent-text)" },
] as const;

export function PasswordStrength({ value }: { value: string }) {
  if (!value) return null;
  const score = scorePassword(value);
  const level = LEVELS[score];

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              background: i < score ? level.color : "var(--border)",
              transition: "background 0.2s ease",
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: level.color, marginTop: 4 }}>
        {level.label}
      </div>
    </div>
  );
}
