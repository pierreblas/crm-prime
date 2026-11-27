import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-static";

/** Las páginas públicas se pueden rastrear; lo que hay detrás del acceso no aporta nada a un buscador. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/handoff", "/connect/", "/platform"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
