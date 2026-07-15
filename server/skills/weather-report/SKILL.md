---
name: weather-report
description: "Standardized format for weather reports, and which tool to use to get accurate data."
source: self-authored
---
# Weather Report Standard

Use the `get_weather` tool (National Weather Service data) for any weather
question, not web_search/WebSearch. Search-engine snippets for weather are
often from cached/stale pages and produce wrong numbers (confirmed: a report
built from web_search results was off by several degrees and wildly wrong on
forecast high/low compared to live NWS station data for the same location
and time). get_weather does not return an air quality index — say so
explicitly rather than guessing one from search results if the user asks.

When providing a weather report, always include:

## Current Conditions
- **Conditions:** (e.g., Overcast, Sunny, Rainy)

## Temperature & Feel
- **Temperature:** [Current Temp]
- **Chance of Rain / Precipitation:** if mentioned in the forecast text

## Environment & Forecast
- **Wind Speed:** [Speed and direction]
- **Day High/Low:** [High Temp] / [Low Temp], from the forecast periods

Always cite the source (National Weather Service) at the bottom of the report.
