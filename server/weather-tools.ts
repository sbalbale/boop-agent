import { z } from "zod";
import { defineRuntimeTool } from "./runtimes/tool.js";
import { runtimeText, type RuntimeTool } from "./runtimes/types.js";

const NAMESPACE = "boop-weather";
// NWS and Nominatim both require a descriptive, non-generic User-Agent —
// requests without one get rejected or rate-limited harder.
const CLIENT_USER_AGENT = "BoopAgent/1.0 (personal self-hosted assistant)";
const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": CLIENT_USER_AGENT, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Request to ${url} failed (${res.status})`);
  return (await res.json()) as T;
}

interface GeocodeResult {
  lat: number;
  lon: number;
  displayName: string;
}

async function geocode(location: string): Promise<GeocodeResult> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", location);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");
  const results = await fetchJson<Array<{ lat: string; lon: string; display_name: string }>>(url.toString());
  if (!results || results.length === 0) {
    throw new Error(`Could not find a US location matching "${location}".`);
  }
  return {
    lat: Number.parseFloat(results[0].lat),
    lon: Number.parseFloat(results[0].lon),
    displayName: results[0].display_name,
  };
}

interface NwsPoint {
  properties: {
    forecast: string;
    observationStations: string;
  };
}

interface NwsForecastPeriod {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  windSpeed: string;
  windDirection: string;
}

interface NwsForecast {
  properties: { periods: NwsForecastPeriod[] };
}

interface NwsStations {
  features: Array<{ properties: { stationIdentifier: string } }>;
}

interface NwsObservation {
  properties: {
    temperature: { value: number | null };
    textDescription: string | null;
  };
}

export function createWeatherTools(namespace = NAMESPACE): RuntimeTool[] {
  return [
    defineRuntimeTool(
      namespace,
      "get_weather",
      'Get current conditions and today/tonight\'s forecast for a US location, from the National Weather Service (api.weather.gov) — live station data and official forecasts, no API key needed. Prefer this over web_search for weather: search-engine snippets are often cached/stale and produce wrong numbers. US locations only. Does NOT include air quality index (that needs a separate EPA AirNow API key, not configured).',
      {
        location: z.string().describe('A US city/state or ZIP, e.g. "Weston, MA" or "02493".'),
      },
      async ({ location }) => {
        try {
          const geo = await geocode(location);
          const point = await fetchJson<NwsPoint>(
            `https://api.weather.gov/points/${geo.lat.toFixed(4)},${geo.lon.toFixed(4)}`,
          );
          const forecast = await fetchJson<NwsForecast>(point.properties.forecast);

          let currentLine = "";
          try {
            const stations = await fetchJson<NwsStations>(point.properties.observationStations);
            const stationId = stations.features[0]?.properties.stationIdentifier;
            if (stationId) {
              const obs = await fetchJson<NwsObservation>(
                `https://api.weather.gov/stations/${stationId}/observations/latest`,
              );
              const c = obs.properties.temperature.value;
              const tempF = c === null ? null : Math.round((c * 9) / 5 + 32);
              if (tempF !== null) {
                currentLine = ` — currently ${tempF}°F${
                  obs.properties.textDescription ? `, ${obs.properties.textDescription}` : ""
                }`;
              }
            }
          } catch {
            // A station not reporting recently (404) shouldn't block the forecast, which still answers the question.
          }

          const periods = forecast.properties.periods.slice(0, 2);
          const lines = [
            `${geo.displayName}${currentLine}`,
            ...periods.map(
              (p) =>
                `${p.name}: ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}, wind ${p.windSpeed} ${p.windDirection}`,
            ),
            "(Source: National Weather Service, api.weather.gov — no AQI available.)",
          ];
          return runtimeText(lines.join("\n"));
        } catch (err) {
          return runtimeText(`Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`, false);
        }
      },
    ),
  ];
}
