"use client";

import { useState } from "react";
import { PasswordStrength } from "./PasswordStrength";

// Campo de contraseña con medidor de fortaleza en vivo. Pensado para vivir
// dentro de un <form> con server action: solo necesita su `name`.
export function PasswordField({
  name = "password",
  placeholder = "Mínimo 8 caracteres",
}: {
  name?: string;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  return (
    <>
      <input
        name={name}
        type="password"
        required
        minLength={8}
        placeholder={placeholder}
        autoComplete="new-password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={input}
      />
      <PasswordStrength value={value} />
    </>
  );
}

const input: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: "var(--r-sm)",
  border: "1px solid var(--border)",
  background: "var(--field)",
  color: "var(--text)",
};
