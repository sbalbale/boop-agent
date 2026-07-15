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

// --- OpenWeatherMap One Call API 4.0 (primary, when a key + subscription is
// configured) — both endpoints wrap their record(s) in a top-level "data"
// array (confirmed against OpenWeatherMap's own docs), not a flat object or
// nested under "current"/"daily" like the older 2.5/3.0 APIs. ---

interface OwmCurrentEntry {
  temp: number;
  feels_like: number;
  humidity: number;
  wind_speed: number;
  weather: Array<{ description: string }>;
}

interface OwmCurrentResponse {
  data: OwmCurrentEntry[];
}

interface OwmDailyEntry {
  temp: { min: number; max: number };
  pop?: number;
}

interface OwmDailyResponse {
  data: OwmDailyEntry[];
}

interface OwmAirPollution {
  list: Array<{ main: { aqi: number } }>;
}

// OpenWeatherMap's free Air Pollution API reports its own 1-5 index, not the
// US EPA 0-500 scale (AirNow/PurpleAir) — labeled explicitly in the output so
// it isn't mistaken for the more familiar 0-500 number. Not part of the
// One Call subscription — same classic endpoint regardless.
const OWM_AQI_LABELS: Record<number, string> = {
  1: "Good",
  2: "Fair",
  3: "Moderate",
  4: "Poor",
  5: "Very Poor",
};

// A daily cap enforced from our side, independent of and stricter than the
// 750/day limit set on the OpenWeatherMap account itself — a second layer so
// a bug or unexpected volume here can't run up against (or rely entirely on)
// the account-level enforcement. Resets at UTC midnight. Configurable since
// "how many calls is safe" depends on whatever cap is set on the account.
const DEFAULT_OPENWEATHER_DAILY_LIMIT = 300;
let openWeatherCallCount = 0;
let openWeatherCountResetAt = 0;

function getOpenWeatherDailyLimit(): number {
  const raw = process.env.BOOP_OPENWEATHER_DAILY_LIMIT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENWEATHER_DAILY_LIMIT;
}

function tryConsumeOpenWeatherBudget(): boolean {
  const now = Date.now();
  if (now >= openWeatherCountResetAt) {
    openWeatherCallCount = 0;
    const nextUtcMidnight = new Date();
    nextUtcMidnight.setUTCHours(24, 0, 0, 0);
    openWeatherCountResetAt = nextUtcMidnight.getTime();
  }
  if (openWeatherCallCount >= getOpenWeatherDailyLimit()) return false;
  openWeatherCallCount += 1;
  return true;
}

async function getOpenWeatherReport(geo: GeocodeResult, apiKey: string): Promise<string> {
  const base = "https://api.openweathermap.org/data/4.0/onecall";
  const [current, daily, air] = await Promise.all([
    fetchJson<OwmCurrentResponse>(`${base}/current?lat=${geo.lat}&lon=${geo.lon}&appid=${apiKey}&units=imperial`),
    fetchJson<OwmDailyResponse>(
      `${base}/timeline/1day?lat=${geo.lat}&lon=${geo.lon}&appid=${apiKey}&units=imperial`,
    ),
    fetchJson<OwmAirPollution>(
      `https://api.openweathermap.org/data/2.5/air_pollution?lat=${geo.lat}&lon=${geo.lon}&appid=${apiKey}`,
    ).catch(() => null),
  ]);

  const currentEntry = current.data[0];
  if (!currentEntry) throw new Error("OpenWeatherMap returned no current-conditions data.");
  const today = daily.data[0];
  const high = today ? Math.round(today.temp.max) : null;
  const low = today ? Math.round(today.temp.min) : null;
  const maxPop = today?.pop !== undefined ? Math.round(today.pop * 100) : null;

  const lines = [
    `${geo.displayName} — currently ${Math.round(currentEntry.temp)}°F (feels like ${Math.round(
      currentEntry.feels_like,
    )}°F), ${currentEntry.weather[0]?.description ?? "conditions unavailable"}`,
    `Humidity: ${currentEntry.humidity}% · Wind: ${Math.round(currentEntry.wind_speed)} mph`,
    high !== null && low !== null
      ? `Today: high ${high}°F / low ${low}°F${maxPop !== null ? `, chance of rain ${maxPop}%` : ""}`
      : "Today's high/low forecast unavailable.",
  ];
  if (air?.list[0]) {
    const aqi = air.list[0].main.aqi;
    lines.push(`Air Quality Index: ${OWM_AQI_LABELS[aqi] ?? aqi} (OpenWeatherMap's 1-5 scale, not the US 0-500 AQI scale)`);
  }
  lines.push("(Source: OpenWeatherMap One Call API 4.0)");
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
        if (apiKey && tryConsumeOpenWeatherBudget()) {
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
