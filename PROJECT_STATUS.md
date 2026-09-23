# Pivka v2 — Project Status

## Current checkpoint
Phase 0 audit completed. Development branch: `pivka-v2`. The production `main` branch has not been changed.

## Existing implementation found
- Static single-page application.
- Main application is contained in `index.html`: HTML, CSS, product data and JavaScript.
- No package.json or application framework detected in the audited paths.
- No backend/database detected.
- Cart exists only in browser memory.
- Age confirmation is stored in localStorage.
- Checkout composes an order and opens WhatsApp.
- Existing upsell modal is hard-coded and is offered only once per session/cart state.
- Existing catalog already has draft beer, packaged beer, fish, chips, snacks and simple ready sets.
- Existing phone/WhatsApp: +995 579 145 634.

## Keep/reuse
- Brand direction and mobile-first visual identity.
- Age gate concept.
- Existing catalog/cart UX as reference.
- Existing WhatsApp fallback ordering path.
- Existing upsell concept, but replace hard-coded SKU popup with data-driven category flow.
- Existing ready sets as seed/reference for the new Bundle/“Рывок” entity.

## Must be rebuilt/added
- Persistent backend/database and admin authentication.
- Product/category/SKU model.
- Inventory ledger + reservations.
- Orders with statuses and price/cost snapshots.
- Real Bundle/“Рывок” engine and bundle builder.
- Gift tiers/progress engine.
- Contextual upsell rules and category drill-down.
- PASS.
- “Спорим на пиво”.
- “Угостить друга”.
- Customers/order history/repeat order.
- Drivers/deliveries/payables.
- Purchases, expenses, finance and daily closing.
- Procurement forecast.
- Analytics events and AI-ready metrics layer.

## Important defects/limitations in current version
- Product data and prices are hard-coded in JavaScript.
- No real stock control.
- Draft beer minimum 2 L is not enforced.
- Ready sets do not consume component inventory because they are ordinary catalog items.
- No order persistence.
- No server-side validation.
- No financial snapshots or COGS.
- Upsell suggestions are fixed SKU IDs and not configurable.
- `upsellOffered` prevents a proper contextual flow after the first offer.
- No payment integration; only cash/transfer labels and WhatsApp handoff.
- No admin panel.

## Implementation plan
- [x] Phase 0 — audit current repository
- [ ] Phase 1 — foundation: backend/database, products, categories, inventory, customers, orders, statuses, admin base
- [ ] Phase 2 — sales experience: new homepage order, gift progress, Рывки, TOP, catalog, contextual upsell, cart
- [ ] Phase 3 — commercial engine: bundle builder, promotion mechanics, gift tiers, PASS, repeat order, product requests
- [ ] Phase 4 — social: beer bet, treat a friend, share links, payment-ready flows
- [ ] Phase 5 — operations: purchases, stock movements, drivers, expenses, daily close, procurement recommendation
- [ ] Phase 6 — analytics/AI-ready layer

## Data still required from owner
Real assortment, purchase prices, selling prices, opening stock, delivery pricing, driver compensation and payment/acquiring fees. Until supplied, use clearly marked placeholders only.

## Handoff rule
Before continuing, read `MASTER_SPEC.md` and this file. Continue from the first incomplete phase. Do not rewrite verified completed phases without a concrete reason. Update this file after each completed checkpoint.
