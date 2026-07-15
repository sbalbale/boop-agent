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

// Shared by both providers — free, no key, works regardless of whether
// OpenWeatherMap's key is valid, so the NWS fallback path never depends on
// OpenWeatherMap succeeding at anything, including geocoding.
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

// --- OpenWeatherMap (primary, when a key is configured) ---

interface OwmCurrent {
  main: { temp: number; feels_like: number; humidity: number };
  weather: Array<{ description: string }>;
  wind: { speed: number };
}

interface OwmDailyEntry {
  temp: { day: number; min: number; max: number; night: number };
  feels_like: { day: number };
  humidity: number;
  speed: number;
  pop?: number;
  weather: Array<{ description: string }>;
}

interface OwmDailyForecast {
  list: OwmDailyEntry[];
}

interface OwmAirPollution {
  list: Array<{ main: { aqi: number } }>;
}

// OpenWeatherMap's free Air Pollution API reports its own 1-5 index, not the
// US EPA 0-500 scale (AirNow/PurpleAir) — labeled explicitly in the output so
// it isn't mistaken for the more familiar 0-500 number.
const OWM_AQI_LABELS: Record<number, string> = {
  1: "Good",
  2: "Fair",
  3: "Moderate",
  4: "Poor",
  5: "Very Poor",
};

async function getOpenWeatherReport(geo: GeocodeResult, apiKey: string): Promise<string> {
  const base = "https://api.openweathermap.org/data/2.5";
  const [current, daily, air] = await Promise.all([
    fetchJson<OwmCurrent>(`${base}/weather?lat=${geo.lat}&lon=${geo.lon}&appid=${apiKey}&units=imperial`),
    fetchJson<OwmDailyForecast>(
      `${base}/forecast/daily?lat=${geo.lat}&lon=${geo.lon}&cnt=1&appid=${apiKey}&units=imperial`,
    ),
    fetchJson<OwmAirPollution>(`${base}/air_pollution?lat=${geo.lat}&lon=${geo.lon}&appid=${apiKey}`).catch(
      () => null,
    ),
  ]);

  const today = daily.list[0];
  const high = today ? Math.round(today.temp.max) : null;
  const low = today ? Math.round(today.temp.min) : null;
  const maxPop = today?.pop !== undefined ? Math.round(today.pop * 100) : null;

  const lines = [
    `${geo.displayName} — currently ${Math.round(current.main.temp)}°F (feels like ${Math.round(
      current.main.feels_like,
    )}°F), ${current.weather[0]?.description ?? "conditions unavailable"}`,
    `Humidity: ${current.main.humidity}% · Wind: ${Math.round(current.wind.speed)} mph`,
    high !== null && low !== null
      ? `Today: high ${high}°F / low ${low}°F${maxPop !== null ? `, chance of rain ${maxPop}%` : ""}`
      : "Today's high/low forecast unavailable.",
  ];
  if (air?.list[0]) {
    const aqi = air.list[0].main.aqi;
    lines.push(`Air Quality Index: ${OWM_AQI_LABELS[aqi] ?? aqi} (OpenWeatherMap's 1-5 scale, not the US 0-500 AQI scale)`);
  }
  lines.push("(Source: OpenWeatherMap)");
  return lines.join("\n");
}

// --- National Weather Service (fallback, free, no key) ---

interface NwsPoint {
  properties: { forecast: string; observationStations: string };
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
  properties: { temperature: { value: number | null }; textDescription: string | null };
}

async function getNwsReport(geo: GeocodeResult): Promise<string> {
  const point = await fetchJson<NwsPoint>(`https://api.weather.gov/points/${geo.lat.toFixed(4)},${geo.lon.toFixed(4)}`);
  const forecast = await fetchJson<NwsForecast>(point.properties.forecast);

  let currentLine = "";
  try {
    const stations = await fetchJson<NwsStations>(point.properties.observationStations);
    const stationId = stations.features[0]?.properties.stationIdentifier;
    if (stationId) {
      const obs = await fetchJson<NwsObservation>(`https://api.weather.gov/stations/${stationId}/observations/latest`);
      const c = obs.properties.temperature.value;
      const tempF = c === null ? null : Math.round((c * 9) / 5 + 32);
      if (tempF !== null) {
        currentLine = ` — currently ${tempF}°F${obs.properties.textDescription ? `, ${obs.properties.textDescription}` : ""}`;
      }
    }
  } catch {
    // A station not reporting recently (404) shouldn't block the forecast, which still answers the question.
  }

  const periods = forecast.properties.periods.slice(0, 2);
  const lines = [
    `${geo.displayName}${currentLine}`,
    ...periods.map(
      (p) => `${p.name}: ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}, wind ${p.windSpeed} ${p.windDirection}`,
    ),
    "(Source: National Weather Service, api.weather.gov — no AQI available.)",
  ];
  return lines.join("\n");
}

export function createWeatherTools(namespace = NAMESPACE): RuntimeTool[] {
  return [
    defineRuntimeTool(
      namespace,
      "get_weather",
      "Get current conditions, today's forecast, and (when available) air quality for a US location. Uses OpenWeatherMap when configured (includes AQI), falling back automatically to the free National Weather Service API otherwise. Prefer this over web_search for weather: search-engine snippets are often cached/stale and produce wrong numbers. US locations only.",
      {
        location: z.string().describe('A US city/state or ZIP, e.g. "Weston, MA" or "02493".'),
      },
      async ({ location }) => {
        let geo: GeocodeResult;
        try {
          geo = await geocode(location);
        } catch (err) {
          return runtimeText(`Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`, false);
        }

        const apiKey = process.env.BOOP_OPENWEATHER_API_KEY;
        if (apiKey) {
          try {
            return runtimeText(await getOpenWeatherReport(geo, apiKey));
          } catch (err) {
            console.warn("[weather] OpenWeatherMap failed, falling back to NWS:", err);
          }
        }

        try {
          return runtimeText(await getNwsReport(geo));
        } catch (err) {
          return runtimeText(`Weather lookup failed: ${err instanceof Error ? err.message : String(err)}`, false);
        }
      },
    ),
  ];
}
