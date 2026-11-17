"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  PRODUCT_PAGE_SIZE,
  parseProductListQuery,
  productListQueryToParams,
  type ProductListQuery,
} from "@crm/shared";

/**
 * La lista de productos vive en la URL: búsqueda, filtros, orden y página. Se
 * recarga o se comparte el enlace y queda igual, y «atrás» vuelve a la página
 * anterior de resultados.
 */
export function useProductListUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const paramsKey = params.toString();
  // La última URL pedida: dos cambios seguidos (mín. y máx. de un rango) no se pisan.
  const latest = useRef(paramsKey);
  useEffect(() => {
    latest.current = paramsKey;
  }, [paramsKey]);

  const query = useMemo(() => parseProductListQuery(new URLSearchParams(paramsKey)), [paramsKey]);
  /** Lo que se pide a la API (sin parámetros ajenos a la lista). */
  const apiQuery = useMemo(() => productListQueryToParams(query).toString(), [query]);
  /** Solo los filtros (sin página, orden ni tamaño): si cambia, la selección ya no vale. */
  const filterQuery = useMemo(
    () => productListQueryToParams({ ...query, page: 1, sort: "recent", pageSize: PRODUCT_PAGE_SIZE }).toString(),
    [query],
  );

  const update = useCallback(
    (change: (q: ProductListQuery) => ProductListQuery, opts: { keepPage?: boolean; push?: boolean } = {}) => {
      let next = change(parseProductListQuery(new URLSearchParams(latest.current)));
      // Cambiar un filtro vuelve a la primera página: la 7 puede no existir ya.
      if (!opts.keepPage) next = { ...next, page: 1 };
      const qs = productListQueryToParams(next).toString();
      if (qs === latest.current) return;
      latest.current = qs;
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [router, pathname],
  );

  return { query, apiQuery, filterQuery, update };
}
