---
name: weather-report
description: "Standardized format for weather reports, and which tool to use to get accurate data."
source: self-authored
---
# Weather Report Standard

Use the `get_weather` tool for any weather question, not web_search/WebSearch.
Search-engine snippets for weather are often from cached/stale pages and
produce wrong numbers (confirmed: a report built from web_search results was
off by several degrees and wildly wrong on forecast high/low compared to
live station data for the same location and time).

get_weather uses OpenWeatherMap when configured (includes air quality index,
feels-like temperature, and humidity), falling back automatically to the
National Weather Service (no AQI) if OpenWeatherMap is unavailable — the
tool result itself says which source answered, so check that rather than
assuming AQI is always present. Only say AQI isn't available if the actual
result doesn't include one; don't guess a number from search results either
way.

When providing a weather report, always include:

## Current Conditions
- **Conditions:** (e.g., Overcast, Sunny, Rainy)

## Temperature & Feel
- **Temperature:** [Current Temp]
- **Feels Like:** [if provided]
- **Chance of Rain / Precipitation:** if mentioned in the result

## Environment & Forecast
- **Wind Speed:** [Speed and direction]
- **Humidity:** [if provided]
- **Air Quality Index:** [if provided — note it is OpenWeather's 1-5 scale, not the US 0-500 scale, if that is the source]
- **Day High/Low:** [High Temp] / [Low Temp]

Always cite the actual source given in the tool result (OpenWeatherMap or
National Weather Service) at the bottom of the report — do not hardcode one.
