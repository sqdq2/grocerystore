# 🛒 Bijasan General Store — Grocery Store Management System

A complete, production-style grocery store platform for **Bijasan General Store, Waghai (Gujarat)** —
a family kirana built for the Computer Science & Engineering semester project.

It ships **two complete applications in one codebase**:

| | Storefront | Operations Console |
|---|---|---|
| Who uses it | Customers & delivery staff | Owner, manager, counter staff |
| URL | `/` | `/admin` |
| Features | Browse, search, filter, cart, checkout, payment, invoice, order tracking | Live dashboard, POS billing counter, inventory, orders, reports, suppliers, customers, staff roles |

**Zero dependencies. Zero build step. Real database.**

---

## ⚡ Quick start

```bash
git clone https://github.com/sqdq2/grocerystore.git
cd grocerystore
npm start          # → http://localhost:3000
```

That's it. No `npm install` is needed — there are no runtime dependencies.
The database is created and seeded automatically on first run.

```bash
npm run dev        # auto-restart on file changes
npm run reset      # wipe the database and re-seed
npm test           # 109 end-to-end API checks
```

**Requires Node.js ≥ 22.5** (uses the built-in `node:sqlite` module — no native builds, no `node_modules`).

---

## 🔐 Sign in

| Role | Email | Password | Can do |
|---|---|---|---|
| **Admin** | `ayush.bagul@bijasan.example` | `Admin@123` | Everything — products, pricing, staff, reports |
| **Manager** | `owner@bijasan.example` | `Owner@123` | Operations, suppliers, customers, reports |
| **Staff** | `priya.sharma@bijasan.example` | `Staff@123` | Billing counter and day-to-day stock only |

The sign-in page has one-click buttons that fill these in, so you can compare
what each role sees. Permissions are enforced **on the server** — a staff member
requesting `/api/reports/sales` gets a 403 even if they open the page directly.

---

## 🗄️ Database

Real **SQLite** (via Node's built-in `node:sqlite`), file at `data/store.db`.
Schema: `server/schema.sql` — 12 tables, 3 indexes, 2 triggers.

```
users ──┐                    orders ── order_items
         ├── stock_movements  │      └── invoices
categories ── products ── stock
suppliers ── products
customers ── orders
alerts · reports
```

**Design decisions worth knowing:**

- **Money is stored as INTEGER paise**, never `REAL`. `₹285.00` is `28500`.
  Floating point never touches a rupee.
- **The product state machine is enforced by a database trigger**
  (`trg_stock_state_after_update`), so `status` can never drift from `quantity`:
  ```
  Available ──(qty ≤ reorder)──▶ Low Stock ──(qty = 0)──▶ Out of Stock
       │                              │                         │
       └──────────(qty = 0)──────────┴────(new stock)────────▶ Available
       │
       └──────────(discontinued)──▶ Discontinued ──(re-introduce)──▶ Available
  ```
- **Every stock change is journalled** in `stock_movements` with a reason
  (`sale` / `restock` / `adjustment` / `return` / `opening`) — a full audit trail.
- **Order lines snapshot the product name, SKU and price**, so an old invoice
  never changes when a product is later renamed or repriced.
- **All queries are parameterised** — the test suite includes a SQL-injection
  attempt that must leave the `products` table intact.

### Seed data

`server/seed.js` generates a realistic store:

- 10 categories, 60 products, 4 suppliers, 8 customers, 5 staff accounts
- **872 orders across 45 days** (~₹10.7 lakh revenue) with weekend seasonality
- Daily goods-receipt runs, so low-stock and out-of-stock states occur naturally
- 3 live alerts (2 out of stock, 1 low stock)

---

## 🧱 Architecture

```
grocery/
├── server/                  ← zero-dependency Node server
│   ├── index.js             HTTP server, routes, static serving
│   ├── schema.sql           relational schema + triggers
│   ├── db.js                SQLite layer, scrypt hashing, transactions
│   ├── seed.js              deterministic demo data
│   ├── auth.js              HMAC tokens + role-based access control
│   ├── catalog.js           products, categories, stock state machine
│   ├── billing.js           cart pricing, order lifecycle, invoices
│   ├── reports.js           SQL aggregates for every chart and KPI
│   ├── customers.js         loyalty ledger
│   ├── http.js              router, JSON, static files, cookies
│   └── routes/              (inline in index.js)
├── public/                  ← storefront + console (no build step)
│   ├── index.html
│   └── assets/
│       ├── css/             design tokens + component CSS
│       └── js/
│           ├── core/        reactive runtime, router, API client
│           ├── ui/          component kit, icons, charts, shell
│           ├── data/        session, cart, favourites, toasts
│           └── pages/       storefront + admin pages
├── scripts/
│   ├── test-api.mjs         109 end-to-end API assertions
│   └── screenshot.mjs       headless browser walkthrough
└── docs/screenshots/       captured UI
```

### Frontend

No framework, no bundler, no `node_modules` — but written like a modern SPA:

- **Reactive core** (`core/react.js`) — signals, scoped effects, a
  hyperscript renderer that patches the DOM. ~250 lines, fully commented.
- **History-API router** (`core/router.js`) — pattern params, guards, scroll
  restoration, lazy page loaders.
- **Hand-built SVG charts** (`ui/charts.js`) — area/line with crosshair, bars,
  donut, sparkline, hourly curve. Theme-aware via CSS variables.
- **Design system** (`assets/css/`) — tokenised colours, type scale, spacing,
  radii, shadows; full light/dark theme; `prefers-reduced-motion` respected.
- **Accessibility** — semantic landmarks, ARIA on every control, visible focus
  rings, keyboard-operable cart drawer, focus trap in modals, ESC to close.

---

## 🔌 API

`GET /api` returns the live endpoint index. Highlights:

```
POST   /api/auth/login | register | logout        GET /api/auth/me
GET    /api/products  ?q=&category=&sort=&page=   GET /api/products/:id
POST   /api/products            PATCH /api/products/:id
POST   /api/products/:id/status                   (discontinue / re-introduce)
GET    /api/inventory            GET /api/inventory/low-stock
POST   /api/inventory/:id/adjust                  (receive / set count)
GET    /api/alerts               POST /api/alerts/read
POST   /api/sales/quote          GET/POST /api/orders
POST   /api/orders/:id/status    GET /api/orders/track/:orderNo
GET    /api/customers            POST /api/customers/:id/loyalty
GET    /api/users                PATCH /api/users/:id
GET    /api/reports/dashboard | sales | inventory | customers
```

**Creating a bill is atomic.** One `BEGIN IMMEDIATE` transaction writes the
order, the line items, the stock deductions, the movement journal, the invoice
and the customer ledger. If any step fails, nothing is written. Overselling is
rejected with a 409 that names exactly which items are short.

---

## ✅ Verification

```bash
npm test
```

109 assertions covering: platform health · authentication and RBAC (including
staff being blocked from admin routes) · catalog search, filters and sorting ·
the full product state machine · goods receipt and adjustments · the complete
sales flow · oversell protection · the order lifecycle and stock restoration on
cancellation · every report and aggregate · CSV/JSON edge cases · SQL
injection resistance · SPA routing and deep links.

```bash
node scripts/screenshot.mjs     # headless-browser walkthrough + UI audit
```

---

## 🗺️ Mapping to the project report

The presentation's UML and requirements are implemented literally:

| Deck | Implementation |
|---|---|
| Class Diagram | `users · categories · products · stock · suppliers · orders · order_items · invoices · customers · alerts · reports` |
| Use Cases 1–3 | Process Sale → `/admin/billing` · Manage Inventory → `/admin/inventory` · Generate Report → `/admin/reports` |
| FR-1 Login & roles | `server/auth.js` — scrypt hashing, signed tokens, server-side RBAC |
| FR-2 Product & stock | `server/catalog.js` — CRUD, reorder levels, movement ledger |
| FR-3 Sales & billing | `server/billing.js` — cart pricing, payment modes, invoice + auto stock deduction |
| State Diagram | Product state machine in SQL triggers |
| Activity Diagram | Sale flow in `billing.js` (stock check → payment → invoice → deduct) |
| Sequence Diagram | Auth → inventory → payment → invoice → stock deduction |
| Deployment Diagram | Browser/Mobile → HTTPS → Web Server → App Server → SQLite |
| Agile model | Two-week sprints, priority order Login → Inventory → Billing → Reports → Alerts |

---

## 🧭 Future scope (from the report)

Mobile app · online ordering · barcode scanning · loyalty points redemption.

---

**Built for the Computer Science & Engineering project, Bijasan General Store.**
Prepared by Ayush Bagul (202603103520026) · Guided by Prof. Santosh Saha.
