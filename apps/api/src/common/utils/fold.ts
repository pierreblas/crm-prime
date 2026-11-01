/**
 * Sin tildes, en minúsculas, espacios colapsados. Para comparar lo que escribe
 * el cliente con lo que configuró la empresa: «Información», «informacion» e
 * «INFORMACIÓN » son lo mismo.
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
