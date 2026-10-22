/**
 * Deterministic seed for Bijasan General Store, Waghai (Gujarat).
 * Mirrors a real neighbourhood kirana: staples, spices, dairy, snacks,
 * household, personal care — priced in ₹, stocked against suppliers, with
 * 45 days of sales history so every report/chart has real shape.
 */
import { openDatabase, migrate, hashPassword, toPaise, tx, q } from './db.js';

const CATEGORIES = [
  { slug: 'staples',      name: 'Rice & Grains',      icon: 'wheat',      accent: 'amber',   desc: 'Everyday atta, rice and pulses for the family kitchen.' },
  { slug: 'pulses',       name: 'Pulses & Dals',      icon: 'bean',       accent: 'lime',    desc: 'Toor, moong, chana and urad — everyday dals.' },
  { slug: 'spices',       name: 'Spices & Masala',    icon: 'flame',      accent: 'orange',  desc: 'Whole and ground spices, masala blends and seeds.' },
  { slug: 'oils',         name: 'Oils & Ghee',        icon: 'droplet',    accent: 'yellow',  desc: 'Cooking oils, refined and cold-pressed, plus pure ghee.' },
  { slug: 'dairy',        name: 'Dairy & Chilled',    icon: 'milk',       accent: 'sky',     desc: 'Milk, curd, paneer, butter and cheese — chilled daily.' },
  { slug: 'snacks',       name: 'Snacks & Namkeen',   icon: 'cookie',     accent: 'rose',    desc: 'Crisps, namkeen, biscuits and instant munchies.' },
  { slug: 'beverages',    name: 'Beverages',          icon: 'cup',        accent: 'teal',    desc: 'Tea, coffee, juices and soft drinks.' },
  { slug: 'household',    name: 'Home & Clean',       icon: 'spray',      accent: 'indigo',  desc: 'Detergents, cleaners and kitchen essentials.' },
  { slug: 'personal',     name: 'Personal Care',      icon: 'sparkles',   accent: 'fuchsia', desc: 'Soap, shampoo, toothpaste and hygiene basics.' },
  { slug: 'baby',         name: 'Baby & Care',        icon: 'baby',       accent: 'emerald', desc: 'Diapers, baby milk and gentle skin care.' },
];

const SUPPLIERS = [
  { name: 'Anand Distributors',  contact: 'Rakesh Patel',  phone: '+91 98795 44120', email: 'orders@ananddist.example',  address: 'GIDC Estate, Bardoli, Gujarat', gst_number: '24AABCA1234M1Z5', lead_time_days: 2 },
  { name: 'Sardar Agro Traders',  contact: 'Hitesh Chaudhry', phone: '+91 94270 88231', email: 'sales@sardaragro.example', address: 'Akshardham Road, Rajkot, Gujarat', gst_number: '24AAECS5566P1ZQ', lead_time_days: 4 },
  { name: 'Girnar Foods Pvt Ltd', contact: 'Priya Desai',   phone: '+91 90999 22118', email: 'cs@girnarfoods.example',  address: 'Veraval, Gujarat', gst_number: '24AACCG7788R1ZK', lead_time_days: 3 },
  { name: 'Kesar Dairy Supply',   contact: 'Meena Solanki', phone: '+91 99250 77341', email: 'supply@kesardairy.example', address: 'Waghai, Surat, Gujarat', gst_number: '24AADCK9900T1ZL', lead_time_days: 1 },
];

// [name, category, brand, pack, unit, price₹, mrp₹, tax%, stock, reorder, featured]
const PRODUCTS = [
  // ---- Staples ----
  ['Aashirvaad Whole Wheat Atta', 'staples', 'Aashirvaad', '10 kg', 'pack', 285, 320, 0, 42, 15, 1],
  ['Aashirvaad Chakki Fresh Atta', 'staples', 'Aashirvaad', '5 kg', 'pack', 165, 185, 0, 18, 15, 0],
  ['Sona Masoori Rice', 'staples', 'Sona', '5 kg', 'pack', 425, 480, 5, 24, 12, 1],
  ['Fortune Sona Masoori Rice', 'staples', 'Fortune', '5 kg', 'pack', 465, 510, 5, 9, 12, 0],
  ['India Gate Basmati Rice', 'staples', 'India Gate', '1 kg', 'pack', 145, 165, 5, 55, 20, 1],
  ['Patanjali Gehun Atta', 'staples', 'Patanjali', '10 kg', 'pack', 295, 330, 0, 6, 10, 0],
  ['Sugar Free Oats', 'staples', 'Quaker', '1 kg', 'pack', 215, 245, 5, 30, 12, 0],

  // ---- Pulses ----
  ['Toor Dal (Arhar)', 'pulses', 'Vadil', '1 kg', 'kg', 168, 189, 0, 38, 15, 1],
  ['Moong Dal', 'pulses', 'Vadil', '1 kg', 'kg', 138, 155, 0, 26, 12, 0],
  ['Chana Dal', 'pulses', 'Vadil', '1 kg', 'kg', 122, 138, 0, 21, 10, 0],
  ['Urad Dal Whole', 'pulses', 'Aashirvaad', '1 kg', 'kg', 152, 172, 0, 4, 10, 0],
  ['Masoor Dal', 'pulses', 'Tata Sampann', '1 kg', 'kg', 118, 132, 0, 33, 12, 0],
  ['Kabuli Chana', 'pulses', 'Aashirvaad', '1 kg', 'kg', 96, 110, 0, 12, 8, 0],
  ['Rajma (Kidney Beans)', 'pulses', 'Aashirvaad', '1 kg', 'kg', 178, 199, 0, 8, 8, 0],

  // ---- Spices ----
  ['Turmeric Powder', 'spices', 'Tata Sampann', '200 g', 'pack', 42, 48, 5, 64, 20, 1],
  ['Red Chilli Powder', 'spices', 'Tata Sampann', '200 g', 'pack', 56, 65, 5, 41, 20, 0],
  ['Coriander Powder', 'spices', 'Tata Sampann', '200 g', 'pack', 38, 44, 5, 28, 15, 0],
  ['Garam Masala', 'spices', 'Tata Sampann', '100 g', 'pack', 68, 79, 5, 37, 15, 1],
  ['Cumin Seeds (Jeera)', 'spices', 'Tata Sampann', '100 g', 'pack', 52, 60, 5, 22, 12, 0],
  ['Garam Masala', 'spices', 'MDH', '100 g', 'pack', 88, 102, 5, 7, 12, 0],
  ['Turmeric Powder', 'spices', 'MDH', '200 g', 'pack', 58, 66, 5, 3, 10, 0],
  ['Red Chilli Powder', 'spices', 'Everest', '100 g', 'pack', 48, 56, 5, 25, 12, 0],

  // ---- Oils & Ghee ----
  ['Sunflower Oil', 'oils', 'Dhara', '1 L', 'L', 148, 165, 5, 32, 15, 1],
  ['Mustard Oil', 'oils', 'Dhara', '1 L', 'L', 178, 199, 5, 19, 12, 0],
  ['Groundnut Oil', 'oils', 'Dhara', '1 L', 'L', 192, 215, 5, 14, 10, 0],
  ['Pure Cow Ghee', 'oils', 'Amul', '500 ml', 'pack', 685, 740, 5, 11, 6, 1],
  ['Pure Desi Ghee', 'oils', 'Patanjali', '1 L', 'L', 1180, 1290, 5, 5, 4, 0],
  ['Sunflower Oil', 'oils', 'Fortune', '1 L', 'L', 138, 152, 5, 26, 12, 0],

  // ---- Dairy ----
  ['Amul Taaza Toned Milk', 'dairy', 'Amul', '1 L', 'L', 68, 72, 5, 60, 25, 1],
  ['Amul Gold Full Cream Milk', 'dairy', 'Amul', '1 L', 'L', 74, 78, 5, 48, 25, 0],
  ['Curd', 'dairy', 'Amul', '400 g', 'pack', 32, 36, 5, 28, 15, 0],
  ['Amul Butter', 'dairy', 'Amul', '100 g', 'pack', 58, 65, 12, 22, 10, 0],
  ['Amul Cheese Slices', 'dairy', 'Amul', '10 slices', 'pack', 145, 165, 12, 15, 8, 0],
  ['Paneer Fresh', 'dairy', 'Local', '200 g', 'pack', 78, 85, 5, 9, 10, 1],
  ['Paneer Fresh', 'dairy', 'Local', '200 g', 'pack', 78, 85, 5, 0, 10, 0],

  // ---- Snacks ----
  ['Salted Potato Chips', 'snacks', 'Lay\'s', '52 g', 'pack', 20, 25, 12, 96, 40, 1],
  ['Aloo Bhujia', 'snacks', 'Haldiram\'s', '400 g', 'pack', 110, 130, 12, 34, 15, 0],
  ['Marie Gold Biscuits', 'snacks', 'Britannia', '500 g', 'pack', 105, 120, 18, 40, 20, 0],
  ['Digestive Biscuits', 'snacks', 'Britannia', '250 g', 'pack', 90, 105, 18, 6, 12, 0],
  ['Masala Peanuts', 'snacks', 'Haldiram\'s', '150 g', 'pack', 45, 55, 12, 52, 20, 0],
  ['Choco Pie', 'snacks', 'Bono', '300 g', 'pack', 120, 135, 18, 11, 10, 0],

  // ---- Beverages ----
  ['Tata Tea Premium', 'beverages', 'Tata Tea', '250 g', 'pack', 145, 165, 5, 44, 20, 1],
  ['Red Label Tea', 'beverages', 'Brooke Bond', '250 g', 'pack', 132, 150, 5, 26, 15, 0],
  ['Instant Coffee', 'beverages', 'Nescafé', '100 g', 'pack', 320, 380, 18, 8, 8, 0],
  ['Mango Juice', 'beverages', 'Maaza', '1 L', 'L', 125, 140, 12, 31, 15, 0],
  ['Orange Juice', 'beverages', 'Real', '1 L', 'L', 165, 185, 12, 18, 10, 0],
  ['Cola Soft Drink', 'beverages', 'Coca-Cola', '750 ml', 'L', 45, 50, 28, 72, 30, 0],

  // ---- Household ----
  ['Washing Powder', 'household', 'Surf Excel', '2 kg', 'pack', 425, 480, 18, 23, 10, 1],
  ['Detergent Liquid', 'household', 'Ariel', '2 L', 'L', 560, 640, 18, 14, 8, 0],
  ['Dishwash Liquid', 'household', 'Vim', '750 ml', 'L', 175, 200, 18, 27, 12, 0],
  ['Floor Cleaner', 'household', 'Lizol', '1 L', 'L', 195, 225, 18, 19, 10, 0],
  ['Broom Set', 'household', 'Local', '1 pc', 'pc', 85, 99, 18, 16, 8, 0],

  // ---- Personal care ----
  ['Beauty Soap', 'personal', 'Lifebuoy', '4 x 100 g', 'pack', 110, 125, 18, 52, 25, 1],
  ['Antibacterial Soap', 'personal', 'Dettol', '4 x 100 g', 'pack', 190, 210, 18, 33, 15, 0],
  ['Shampoo', 'personal', 'Sunsilk', '340 ml', 'L', 285, 320, 18, 21, 12, 0],
  ['Toothpaste', 'personal', 'Colgate', '200 g', 'pack', 105, 118, 18, 38, 18, 0],
  ['Sandalwood Soap', 'personal', 'Nirula', '4 x 100 g', 'pack', 135, 150, 18, 3, 12, 0],

  // ---- Baby ----
  ['Baby Diapers', 'baby', 'Pampers', 'M 22 pcs', 'pack', 425, 480, 18, 17, 10, 0],
  ['Infant Formula', 'baby', 'Nestlé Nan', '400 g', 'pack', 1180, 1300, 5, 9, 6, 1],
  ['Baby Wash', 'baby', 'Johnson\'s', '200 ml', 'L', 245, 275, 18, 13, 8, 0],
];

const CUSTOMERS = [
  ['Mahesh Patel',    '+919879011234', 'Bhagwa Nagar, Waghai',      2450, 18420],
  ['Rina Shah',       '+919825522334', 'Station Road, Bardoli',     890,  6420],
  ['Vikram Solanki',  '+919909144556', 'Kamrej, Surat',            1240,  9850],
  ['Anjali Desai',    '+919712200778', 'GIDC Estate, Bardoli',      340,  2110],
  ['Kiran Bhatt',     '+919825100992', 'Pethapur, Bardoli',         1980, 15640],
  ['Sneha Joshi',     '+919909887766', 'Vyara, Surat',               620,  4310],
  ['Ramesh Chaudhary','+917021998833','Valsad',                     410,  2980],
  ['Pooja Mehta',     '+919879123007', 'Surat Road, Bardoli',       1120,  8760],
];

const STAFF = [
  ['Ayush Bagul',     'ayush.bagul@bijasan.example',    '+919876500101', 'admin',   'Admin@123'],
  ['Mahendar Chaudhary','owner@bijasan.example',        '+919427805111', 'manager', 'Owner@123'],
  ['Priya Sharma',     'priya.sharma@bijasan.example',  '+919876500102', 'staff',   'Staff@123'],
  ['Ravi Patel',       'ravi.patel@bijasan.example',    '+919876500103', 'staff',   'Staff@123'],
  ['Nisha Rana',       'nisha.rana@bijasan.example',    '+919876500104', 'staff',   'Staff@123'],
];

/* ------------------------------------------------------------------ util -- */
let seed = 20260921;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/* ------------------------------------------------------------------ main -- */
export function seedDatabase(file) {
  const db = openDatabase(file);
  migrate(db);

  const already = q.scalar(db, 'SELECT COUNT(*) AS c FROM products');
  if (already > 0) return { db, skipped: true };

  tx(db, () => {
    /* users */
    const insUser = `INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)`;
    for (const [name, email, phone, role, pw] of STAFF) {
      q.run(db, insUser, name, email, phone, hashPassword(pw), role);
    }

    /* categories */
    const catId = {};
    CATEGORIES.forEach((c, i) => {
      const r = q.run(db,
        `INSERT INTO categories (slug,name,description,icon,accent,sort_order) VALUES (?,?,?,?,?,?)`,
        c.slug, c.name, c.desc, c.icon, c.accent, i);
      catId[c.slug] = Number(r.lastInsertRowid);
    });

    /* suppliers */
    const supIds = SUPPLIERS.map((s) => Number(q.run(db,
      `INSERT INTO suppliers (name,contact,phone,email,address,gst_number,lead_time_days)
       VALUES (?,?,?,?,?,?,?)`, s.name, s.contact, s.phone, s.email, s.address, s.gst_number, s.lead_time_days).lastInsertRowid));

    /* products + stock */
    const products = [];
    const usedSlugs = new Map();
    PRODUCTS.forEach((row, i) => {
      const [name, cat, brand, pack, unit, price, mrp, tax, stock, reorder, featured] = row;
      const sku = `BGS-${String(i + 1).padStart(4, '0')}`;
      // some product names already carry the brand ("Turmeric Powder · MDH")
      const display = name.toLowerCase().includes(String(brand).toLowerCase())
        ? name
        : `${brand} ${name}`;
      // same brand+name can appear twice (different pack) — disambiguate the slug
      const baseSlug = slugify(display);
      const seen = (usedSlugs.get(baseSlug) || 0) + 1;
      usedSlugs.set(baseSlug, seen);
      const slug = seen > 1 ? `${baseSlug}-${seen}` : baseSlug;
      const priceP = toPaise(price);
      const mrpP = toPaise(mrp);
      const pid = Number(q.run(db,
        `INSERT INTO products (sku,slug,name,description,category_id,supplier_id,price,mrp,unit,pack_size,tax_rate,barcode,brand,is_featured)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        sku, slug, name,
        `${display} ${pack}. Stocked fresh and kept at Bijasan General Store, Waghai — ask us for a fresh batch.`,
        catId[cat], supIds[i % supIds.length], priceP, mrpP, unit, pack, tax,
        `890${String(1000000000 + i * 7919).slice(0, 10)}`, brand, featured
      ).lastInsertRowid);
      const opening = stock * 3;                      // store holds ~3 reorder cycles
      q.run(db,
        `INSERT INTO stock (product_id,quantity,reorder_level,reorder_quantity,last_restocked_at)
         VALUES (?,?,?,?,?)`, pid, opening, reorder, reorder * 3, new Date(Date.now() - int(1, 20) * 864e5).toISOString());
      products.push({ id: pid, price: priceP, tax, stock: opening, name, sku, reorder, reorderQty: reorder * 3 });
      q.run(db,
        `INSERT INTO stock_movements (product_id,change,balance_after,reason,user_id)
         VALUES (?,?,?,?,?)`, pid, opening, opening, 'opening', 1);
    });

    /* customers */
    const custIds = CUSTOMERS.map(([name, phone, address, points, spent]) => {
      const email = `${slugify(name).replace(/-/g, '.')}@example.com`;
      return Number(q.run(db,
        `INSERT INTO customers (name,email,phone,address,city,postal_code,loyalty_points,total_spent)
         VALUES (?,?,?,?,?,?,?,?)`,
        name, email, phone, address, 'Waghai', '394730', points, toPaise(spent)).lastInsertRowid);
    });

    /* 45 days of sales history */
    const insOrder = `INSERT INTO orders
      (order_no,customer_id,user_id,status,payment_mode,payment_status,subtotal,discount,tax,delivery_fee,total,address,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const insItem  = `INSERT INTO order_items
      (order_id,product_id,product_name,sku,pack_size,unit_price,quantity,tax_rate,line_total)
      VALUES (?,?,?,?,?,?,?,?,?)`;
    const insInv   = `INSERT INTO invoices (invoice_no,order_id,amount,payment_mode,issued_at) VALUES (?,?,?,?,?)`;
    const movStock = `INSERT INTO stock_movements (product_id,change,balance_after,reason,reference,user_id,created_at)
                      VALUES (?,?,?,?,?,?,?)`;
    const updStock = `UPDATE stock SET quantity = quantity - ?, updated_at = ? WHERE product_id = ?`;
    const bumpCust = `UPDATE customers SET orders_count = orders_count + 1, total_spent = total_spent + ?,
                      loyalty_points = loyalty_points + ? WHERE id = ?`;

    let orderSeq = 0, invSeq = 0, movSeq = 0;
    for (let d = 44; d >= 0; d--) {
      const day = new Date(Date.now() - d * 864e5);
      const dayIso = day.toISOString();

      /* ---- morning goods-receipt: top up anything at/below reorder level ---- */
      const setStock = `UPDATE stock SET quantity = ?, last_restocked_at = ?, updated_at = ? WHERE product_id = ?`;
      for (const p of products) {
        if (p.stock <= p.reorder) {
          const received = p.reorderQty;
          const before = p.stock;
          p.stock = before + received;
          q.run(db, setStock, p.stock, dayIso, dayIso, p.id);
          q.run(db, movStock, p.id, received, p.stock, 'restock', `GRN-${dayIso.slice(0, 10)}`, 2, dayIso);
        }
      }

      const dow = day.getDay();
      const base = (dow === 0 || dow === 6) ? 26 : 14;      // weekends busier
      const ordersToday = Math.max(4, base + int(-4, 7));

      for (let k = 0; k < ordersToday; k++) {
        const lineCount = int(1, 6);
        const inStock = products.filter((x) => x.stock > 0);
        if (!inStock.length) continue;
        const chosen = new Set();
        let guard = 0;
        while (chosen.size < lineCount && guard++ < 40) chosen.add(pick(inStock).id);

        let subtotal = 0, tax = 0, gross = 0;
        const lines = [...chosen].map((pid) => {
          const p = products.find((x) => x.id === pid);
          const qty = int(1, 3);
          const lineTax = Math.round(p.price * qty * (p.tax / 100));
          const lineTotal = p.price * qty + lineTax;
          subtotal += p.price * qty;
          tax += lineTax;
          gross += lineTotal;
          return { p, qty, lineTax, lineTotal };
        });
        if (!lines.length) continue;

        const discount = rnd() < 0.25 ? Math.round(gross * 0.05) : 0;
        const delivery = gross >= 30000 ? 0 : 2500;
        const total = gross - discount + delivery;
        const status = d === 0
          ? pick(['pending', 'confirmed', 'packed', 'out_for_delivery', 'delivered', 'delivered', 'delivered'])
          : pick(['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'cancelled']);
        const payStatus = status === 'cancelled' ? 'refunded' : (rnd() < 0.94 ? 'paid' : 'pending');
        const payMode = pick(['cash', 'cash', 'upi', 'upi', 'upi', 'card']);
        const cust = pick(custIds);
        const cashier = int(2, 5);
        const ts = new Date(day.setHours(int(8, 21), int(0, 59), 0)).toISOString();

        orderSeq++;
        const orderNo = `BGS-2609-${String(1000 + orderSeq)}`;
        const oid = Number(q.run(db, insOrder,
          orderNo, cust, cashier, status, payMode, payStatus,
          subtotal, discount, tax, delivery, total,
          CUSTOMERS[(cust - 1) % CUSTOMERS.length][2], ts, ts).lastInsertRowid);

        for (const { p, qty, lineTax, lineTotal } of lines) {
          q.run(db, insItem, oid, p.id, p.name, p.sku, null, p.price, qty, p.tax, lineTotal);
          // never let the journal push stock below zero — clamp the deduction
          const take = Math.min(qty, p.stock);
          const bal = p.stock - take;
          if (take > 0) {
            q.run(db, movStock, p.id, -take, bal, 'sale', orderNo, cashier, ts);
            q.run(db, updStock, take, ts, p.id);
          }
          p.stock = bal;
        }

        if (status !== 'cancelled') {
          invSeq++;
          q.run(db, insInv, `INV-26-${String(10000 + invSeq)}`, oid, total, payMode, ts);
          if (payStatus === 'paid') {
            q.run(db, bumpCust, total, Math.floor(total / 10000), cust);
          }
        }
      }
      void movSeq;
    }

    /* today's end-of-day state: fresh items that sold out, low-stock lines */
    const soldOutToday = q.all(db,
      `SELECT p.id,p.name,s.quantity FROM products p JOIN stock s ON s.product_id=p.id
       WHERE p.category_id = (SELECT id FROM categories WHERE slug='dairy')
       ORDER BY s.quantity ASC LIMIT 2`);
    for (const r of soldOutToday) {
      const lost = r.quantity;
      q.run(db, `UPDATE stock SET quantity = 0, updated_at = datetime('now') WHERE product_id = ?`, r.id);
      if (lost > 0) {
        q.run(db, movStock, r.id, -lost, 0, 'sale', 'BGS-2609-walkin', 3, new Date().toISOString());
      }
    }

    /* low-stock alerts */
    const lowRows = q.all(db, `SELECT p.id,p.name,s.quantity,s.reorder_level FROM products p
                                JOIN stock s ON s.product_id=p.id WHERE s.quantity <= s.reorder_level`);
    const insAlert = `INSERT INTO alerts (product_id,type,message,severity) VALUES (?,?,?,?)`;
    for (const r of lowRows) {
      q.run(db, insAlert, r.id,
        r.quantity === 0 ? 'out_of_stock' : 'low_stock',
        r.quantity === 0
          ? `${r.name} is out of stock — reorder required`
          : `${r.name} is low — ${r.quantity} left (reorder at ${r.reorder_level})`,
        r.quantity === 0 ? 'critical' : 'warning');
    }

    /* a saved report snapshot */
    const daily = q.get(db,
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders
       WHERE date(created_at) = date('now') AND status <> 'cancelled'`);
    q.run(db, `INSERT INTO reports (report_type,period,payload,generated_by) VALUES (?,?,?,?)`,
      'sales_daily', new Date().toISOString().slice(0, 10),
      JSON.stringify({ orders: daily.orders, revenue: daily.revenue, currency: 'INR' }), 1);
  });

  return {
    db,
    skipped: false,
    counts: {
      categories: q.scalar(db, 'SELECT COUNT(*) c FROM categories'),
      products:   q.scalar(db, 'SELECT COUNT(*) c FROM products'),
      suppliers:  q.scalar(db, 'SELECT COUNT(*) c FROM suppliers'),
      customers:  q.scalar(db, 'SELECT COUNT(*) c FROM customers'),
      orders:     q.scalar(db, 'SELECT COUNT(*) c FROM orders'),
      items:      q.scalar(db, 'SELECT COUNT(*) c FROM order_items'),
      invoices:   q.scalar(db, 'SELECT COUNT(*) c FROM invoices'),
      alerts:     q.scalar(db, 'SELECT COUNT(*) c FROM alerts'),
    },
  };
}

// Run directly:  node server/seed.js
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const res = seedDatabase();
  console.log(res.skipped ? 'Database already seeded.' : `Seeded: ${JSON.stringify(res.counts, null, 2)}`);
  res.db.close();
}