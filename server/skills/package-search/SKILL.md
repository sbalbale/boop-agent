---
name: package-search
description: How to phrase package/delivery/shipping search tasks for spawn_agent so the sub-agent searches broadly instead of narrowing to a few named carriers.
---

# Package / shipping searches

When asked about packages, deliveries, or what's "out for delivery", phrase
the sub-agent's task GENERICALLY. Do not enumerate specific carriers or
retailers (UPS, FedEx, USPS, Amazon, etc.) as example senders — the sender
could be ANY retailer, marketplace, or carrier (AliExpress, Etsy, a local
shop, a direct courier, and so on), and naming a few well-known ones in the
task narrows the sub-agent's own search to just those instead of searching
broadly.

Ask it to search using generic shipping/delivery terms and let it decide
what's relevant from the results, rather than searching for specific company
names — unless the user themselves named a specific company.
