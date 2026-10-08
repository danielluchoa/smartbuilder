import { useEffect, useRef, useState } from "react";
// Vendored Meta map runtime (map-runtime/dist). Loaded on demand the first
// time a preview mounts; bundled as text and executed from a Blob URL so the
// artifact ships a single JS bundle.
import hatchMapsJsText from "./assets/hatch-maps-js.txt";
import hatchMapsCssText from "./assets/hatch-maps-css.txt";
import { mountMap } from "./map-helpers.mjs";
import { useT } from "./i18n";

let runtimePromise: Promise<boolean> | null = null;

function loadMapRuntime(): Promise<boolean> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = new Promise<boolean>((resolve) => {
    if (!document.querySelector("style[data-hatch-maps]")) {
      const style = document.createElement("style");
      style.setAttribute("data-hatch-maps", "");
      style.textContent = hatchMapsCssText;
      document.head.appendChild(style);
    }
    const w = window as unknown as { HatchMaps?: unknown };
    if (w.HatchMaps) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = URL.createObjectURL(new Blob([hatchMapsJsText], { type: "text/javascript" }));
    script.async = true;
    script.onload = () => resolve(!!(window as unknown as { HatchMaps?: unknown }).HatchMaps);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return runtimePromise;
}

/** Small map preview of one geocoded point, using the bundled Meta map
 *  control. Degrades to a plain coordinate readout when the surface cannot
 *  render the map. */
export function GeoMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const tr = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUnavailable(false);
    loadMapRuntime().then((ok) => {
      if (!ok || cancelled || !ref.current) {
        if (!ok && !cancelled) setUnavailable(true);
        return;
      }
      const handle = mountMap(
        ref.current,
        { places: [{ label, lat, lng }], baseStyle: "light" },
        () => {
          if (!cancelled) setUnavailable(true);
        },
      );
      if (!handle && !cancelled) setUnavailable(true);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng, label]);

  if (unavailable) {
    return (
      <p className="rounded-xl bg-[var(--surface2)] px-3 py-2 text-xs text-[var(--dim)]">
        {tr("Map preview unavailable on this device — coordinates:", "Pré-visualização do mapa indisponível neste aparelho — coordenadas:", "Vista previa del mapa no disponible en este dispositivo: coordenadas:")} {lat.toFixed(6)}, {lng.toFixed(6)}
      </p>
    );
  }
  return (
    <div
      ref={ref}
      role="img"
      aria-label={tr(`Map preview: ${label} at ${lat.toFixed(5)}, ${lng.toFixed(5)}`, `Pré-visualização do mapa: ${label} em ${lat.toFixed(5)}, ${lng.toFixed(5)}`, `Vista previa del mapa: ${label} en ${lat.toFixed(5)}, ${lng.toFixed(5)}`)}
      className="h-52 w-full overflow-hidden rounded-xl border border-[var(--border)]"
    />
  );
}
