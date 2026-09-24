# MASTER SPEC — Pivka dlya ryvka v2

This file is the durable architecture contract for the project.

## Product goal
Build a mobile-first local commerce and operations system, not merely a catalog. Customer flow: selling mechanics → ready “Рывки” → TOP → catalog → contextual upsells → cart/gift progress → checkout → order. Owner flow: orders → inventory → delivery → costs/finance → daily close → tomorrow procurement → analytics/AI.

## Core commercial mechanics
1. Gift tiers are prominent and configurable. Only the highest unlocked tier applies; tiers do not stack. Gift stock comes from the same SKU inventory.
2. “Угостить друга”: sender chooses goods/bundle and prepays; recipient receives a link and confirms delivery details.
3. “Спорим на пиво?”: create bet → choose stake → opponent accepts → loser confirms loss and prepays → winner confirms address → one paid delivery to winner.
4. PASS: working placeholder 3 GEL/month, but price, minimum basket and delivery conditions are admin-configurable.
5. Ready “Рывки” are real bundle entities with components, quantities, cost, price, customer value and inventory dependency.
6. Bundle promotion engine must support special component price, fixed/percentage discount, extra quantity (“6 instead of 4”), and +1/bonus.
7. Individual products trigger contextual upsell category flows. Bundle contents must suppress redundant upsells.
8. Repeat previous order by phone-based customer profile, with current price/stock revalidation.
9. “Не нашли товар?” demand-request capture.

## Catalog and inventory
Launch architecture includes draft beer, strong alcohol, fish, seafood, cheese, nuts, snacks, soft drinks and extensible categories. No ice.
Draft beer: configurable minimum quantity; working requirement is 2 L minimum. Stock units must support liters, bottles, pieces/weight as needed.
All individual sales, bundle components and gifts consume the same SKU stock.
Maintain an inventory movement ledger and stock reservations to prevent overselling.

## Orders
Statuses at minimum: NEW, CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, REFUNDED.
Statuses control reservations, stock finalization, revenue recognition, driver payable and analytics.
Store sale price and cost snapshots on order items.

## Operations/finance
Track revenue, COGS, gross profit, discounts, gift cost, delivery income, driver cost/payable, acquiring/payment fees, packaging/other direct costs, returns/write-offs and other expenses.
Do not conflate inventory purchases/cash outflow with COGS.
Driver compensation must support per-order, shift-fixed and manual amount.
Daily owner dashboard answers: sold today, profit, low stock, payables and what to buy tomorrow.

## Procurement forecast
Start transparent, not black-box AI: current stock + recent demand + same weekday when available + trend + safety stock + promotions + manual demand modifier. Show the calculation behind each recommended purchase quantity.

## Analytics / AI-ready
Calculations are deterministic in backend. AI later interprets verified aggregates.
Capture events including product view/add/remove, upsell open/category/add, bundle view/add, gift progress/unlock/select, PASS offer/purchase, bet created/accepted, friend gift created, checkout, payment, delivery, cancellation and repeat order.
Prepare metrics for revenue, gross profit, AOV, repeat rate, SKU/bundle profitability, upsell attach rate, gift-tier effect, hourly/weekday sales, stock/write-offs/cancellations and driver payables.

## Admin
Owner-facing sections: Today, Orders, Catalog, Inventory, Рывки, Promotions, Gifts, Upsells, Customers, PASS, Bets, Treat a Friend, Delivery, Drivers, Purchases, Expenses, Finance, Analytics, Settings.
Normal commercial changes must not require code edits.

## UX rules
Mobile first. Selling mechanics are large and visible before the ordinary catalog. Do not hide gift progress, bet, friend gift or PASS in the footer.
Show bundle value honestly: separate-item total vs bundle price/value, or extra quantity. No fake scarcity or fake crossed-out pricing.

## Security
Admin is private. Secrets are never committed to frontend/repository. Use environment variables. Prepare OWNER, ADMIN, STAFF and DRIVER roles. Keep age confirmation and allow later receipt/ID verification rules.

## Delivery scope
Small-city simple dispatch only: prepare → assign driver → out for delivery → delivered. Do not build enterprise routing or complex ETA.

## Payment scope
Use an abstract payment layer. Bet and Treat-a-Friend require prepayment before delivery. Normal-order methods remain configurable. Exact Georgian acquiring provider will be selected later.

## Build phases
Phase 0 audit → Phase 1 foundation → Phase 2 sales experience → Phase 3 commercial engine → Phase 4 social → Phase 5 operations → Phase 6 analytics/AI-ready.
After each phase: run/check mobile and desktop, fix defects, commit, and update PROJECT_STATUS.md.

## Current data policy
Real economics are pending. Do not invent final prices, margins, stock or gift thresholds. Placeholder data must be visibly marked and replaceable from admin.
