/*
  Telegram VPN Filter Shop - Cloudflare Worker + D1
  Full compact version
  D1 binding: DB
  Change BOT_TOKEN and OWNER_ID before production use.
*/

const BOT_TOKEN = "8820718348:AAFP-JlnXDoodiFloxHaNmXyTzRAON8_1E4";
const OWNER_ID = "8826874942";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const KB = {
  customer: [
    ["🛍️ خرید فیلتر", "📦 سرویس‌های من"],
    ["🎟️ کد تخفیف", "📥 دریافت کانفیگ"],
    ["🧾 رسیدهای من", "👤 حساب کاربری"],
    ["🔄 تمدید سرویس", "🆘 پشتیبانی"],
    ["📘 آموزش اتصال ساب"]
  ],
  owner: [
    ["💰 مدیریت فروش", "🎟️ مدیریت تخفیف"],
    ["👥 مدیریت کاربران", "🧾 سفارش و پرداخت"],
    ["📢 ارتباط با کاربران", "📊 آمار"],
    ["⚙️ سیستم"]
  ],
  sales: [
    ["💵 مدیریت قیمت‌ها", "📦 مدیریت حجم‌ها"],
    ["➕ ساخت پلن", "✏️ ویرایش پلن"],
    ["🗑️ حذف پلن", "⬅️ بازگشت"]
  ],
  discount: [
    ["➕ ساخت کد تخفیف", "📋 لیست کدهای تخفیف"],
    ["❌ ابطال کد تخفیف", "👤 کد اختصاصی برای کاربر"],
    ["📊 آمار استفاده از کدها", "⬅️ بازگشت"]
  ],
  users: [
    ["👤 لیست کاربران", "🔎 جستجوی کاربر"],
    ["🚫 مسدود کردن کاربر", "🔓 رفع مسدودی"],
    ["🎁 دادن سرویس به کاربر", "🔄 تمدید سرویس کاربر"],
    ["❌ لغو سرویس کاربر", "⬅️ بازگشت"]
  ],
  orders: [
    ["🧾 همه رسیدها", "⏳ رسیدهای در انتظار بررسی"],
    ["✅ پرداخت‌های تأییدشده", "❌ پرداخت‌های ردشده"],
    ["🔍 جستجوی سفارش", "⬅️ بازگشت"]
  ],
  comm: [
    ["📣 پیام همگانی", "👤 پیام به کاربر"],
    ["📢 اطلاعیه جدید", "⬅️ بازگشت"]
  ],
  system: [
    ["⚙️ تنظیمات ربات", "📜 لاگ فعالیت‌ها"],
    ["🔐 مدیریت دسترسی", "🔄 وضعیت سیستم"],
    ["⬅️ بازگشت"]
  ]
};

function menu(rows) {
  return { keyboard: rows, resize_keyboard: true };
}
function inline(rows) {
  return { inline_keyboard: rows };
}
async function tg(method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(body)
  });
  return r.json();
}
async function send(chat_id, text, extra={}) {
  return tg("sendMessage", {chat_id, text, ...extra});
}
async function edit(chat_id, message_id, text, extra={}) {
  return tg("editMessageText", {chat_id, message_id, text, ...extra});
}
async function answerCallback(id, text="") {
  return tg("answerCallbackQuery", {callback_query_id:id, text});
}
function esc(s) {
  return String(s ?? "").replace(/[<>]/g, "");
}
function money(n) {
  return Number(n||0).toLocaleString("fa-IR") + " تومان";
}
function uid(x) { return String(x); }
function username(u) { return u?.username ? `@${u.username}` : "ندارد"; }

async function init(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY, username TEXT, first_name TEXT, blocked INTEGER DEFAULT 0,
      state TEXT, state_data TEXT, created_at INTEGER, updated_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS plans(
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, volume TEXT, price INTEGER,
      active INTEGER DEFAULT 1, created_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS orders(
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, plan_id INTEGER,
      plan_name TEXT, volume TEXT, amount INTEGER, discount_code TEXT, discount_percent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending', receipt_file_id TEXT, receipt_type TEXT,
      reject_reason TEXT, sub_url TEXT, created_at INTEGER, updated_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS services(
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, plan_name TEXT, volume TEXT,
      amount INTEGER, sub_url TEXT, active INTEGER DEFAULT 1, expires_at INTEGER,
      created_at INTEGER, order_id INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS coupons(
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE, percent INTEGER,
      max_uses INTEGER DEFAULT 1, used_count INTEGER DEFAULT 0, user_id TEXT,
      volume TEXT, active INTEGER DEFAULT 1, created_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS coupon_uses(
      id INTEGER PRIMARY KEY AUTOINCREMENT, coupon_id INTEGER, user_id TEXT,
      order_id INTEGER, created_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS logs(
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT, action TEXT, details TEXT, created_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS admins(
      user_id TEXT PRIMARY KEY, role TEXT DEFAULT 'owner', active INTEGER DEFAULT 1
    )`)
  ]);
  await db.prepare(`INSERT OR IGNORE INTO admins(user_id,role) VALUES(?, 'owner')`).bind(OWNER_ID).run();
}

async function getUser(db, id) {
  return db.prepare(`SELECT * FROM users WHERE id=?`).bind(uid(id)).first();
}
async function upsertUser(db, u) {
  const id = uid(u.id), now = Date.now();
  await db.prepare(`INSERT INTO users(id,username,first_name,created_at,updated_at)
    VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, updated_at=excluded.updated_at`)
    .bind(id, u.username||"", u.first_name||"", now, now).run();
  return getUser(db,id);
}
async function setState(db,id,state,data={}) {
  await db.prepare(`UPDATE users SET state=?, state_data=?, updated_at=? WHERE id=?`)
    .bind(state, JSON.stringify(data), Date.now(), uid(id)).run();
}
async function clearState(db,id) { await setState(db,id,"",{}); }
async function log(db, actor, action, details="") {
  await db.prepare(`INSERT INTO logs(actor_id,action,details,created_at) VALUES(?,?,?,?)`)
    .bind(uid(actor), action, details, Date.now()).run();
}
async function isOwner(db,id) {
  const x = await db.prepare(`SELECT 1 FROM admins WHERE user_id=? AND active=1`).bind(uid(id)).first();
  return !!x;
}
function stateData(u) {
  try { return JSON.parse(u?.state_data || "{}"); } catch { return {}; }
}

async function home(db, chat, id) {
  await clearState(db,id);
  if (await isOwner(db,id)) {
    return send(chat, "👑 پنل مالک\n\nاز منوی زیر مدیریت کامل ربات را انجام بده:", {reply_markup:menu(KB.owner)});
  }
  return send(chat, "🛍️ فروشگاه سرویس\n\nیکی از گزینه‌های زیر را انتخاب کن:", {reply_markup:menu(KB.customer)});
}

async function listPlans(db) {
  return (await db.prepare(`SELECT * FROM plans WHERE active=1 ORDER BY id DESC`).all()).results || [];
}
async function buyMenu(db, chat, id) {
  const plans = await listPlans(db);
  if (!plans.length) return send(chat,"فعلاً پلنی برای فروش تعریف نشده است.");
  const rows = plans.map(p=>[{text:`${p.name} | ${p.volume} | ${money(p.price)}`,callback_data:`buy:${p.id}`}]);
  return send(chat,"🛍️ پلن موردنظر را انتخاب کن:",{reply_markup:inline(rows)});
}
async function showServices(db,chat,id) {
  const r = await db.prepare(`SELECT * FROM services WHERE user_id=? ORDER BY id DESC`).bind(uid(id)).all();
  const a=r.results||[];
  if (!a.length) return send(chat,"📦 سرویس فعالی نداری.");
  let t="📦 سرویس‌های من\n\n";
  for(const s of a) t += `#${s.id} | ${esc(s.plan_name)} | ${esc(s.volume)}\n🔗 ${s.sub_url||"—"}\nوضعیت: ${s.active?"🟢 فعال":"🔴 غیرفعال"}\n\n`;
  return send(chat,t);
}
async function showReceipts(db,chat,id) {
  const r=await db.prepare(`SELECT id,plan_name,volume,amount,status,created_at,reject_reason FROM orders WHERE user_id=? ORDER BY id DESC`).bind(uid(id)).all();
  const a=r.results||[];
  if(!a.length) return send(chat,"🧾 هنوز رسیدی ثبت نکردی.");
  let t="🧾 رسیدهای من\n\n";
  for(const o of a) t+=`سفارش #${o.id}\n${o.plan_name} | ${o.volume} | ${money(o.amount)}\nوضعیت: ${statusFa(o.status)}\n${o.reject_reason?`دلیل رد: ${o.reject_reason}\n`:""}\n`;
  return send(chat,t);
}
function statusFa(s) { return ({pending:"⏳ در انتظار بررسی",approved:"✅ تأیید شده",rejected:"❌ رد شده"})[s]||s; }

async function account(db,chat,id) {
  const u=await getUser(db,id);
  const c=await db.prepare(`SELECT COUNT(*) c FROM orders WHERE user_id=?`).bind(uid(id)).first();
  const s=await db.prepare(`SELECT COUNT(*) c FROM services WHERE user_id=? AND active=1`).bind(uid(id)).first();
  return send(chat,`👤 حساب کاربری\n\n🆔 ${id}\n🔹 نام کاربری: ${u?.username?`@${u.username}`:"ندارد"}\n🛒 سفارش‌ها: ${c?.c||0}\n📦 سرویس فعال: ${s?.c||0}`);
}
async function tutorial(chat) {
  return send(chat,`📘 آموزش اتصال ساب

1️⃣ لینک اشتراک را کپی کن.
2️⃣ وارد برنامه VPN شو.
3️⃣ بخش «اشتراک‌ها / Subscription» را باز کن.
4️⃣ لینک را وارد کن.
5️⃣ ذخیره یا Update را بزن.
6️⃣ کانفیگ را انتخاب و Connect کن.

اگر اسم گزینه‌ها در برنامه تو متفاوت بود، از 🆘 پشتیبانی کمک بگیر.`);
}
async function support(chat) {
  return send(chat,"🆘 پشتیبانی\n\nمشکل یا سوالت را همین‌جا برای پشتیبانی ارسال کن.");
}

async function ownerSales(db,chat) { return send(chat,"💰 مدیریت فروش",{reply_markup:menu(KB.sales)}); }
async function ownerDiscount(db,chat) { return send(chat,"🎟️ مدیریت تخفیف",{reply_markup:menu(KB.discount)}); }
async function ownerUsers(db,chat) { return send(chat,"👥 مدیریت کاربران",{reply_markup:menu(KB.users)}); }
async function ownerOrders(db,chat) { return send(chat,"🧾 سفارش و پرداخت",{reply_markup:menu(KB.orders)}); }
async function ownerComm(db,chat) { return send(chat,"📢 ارتباط با کاربران",{reply_markup:menu(KB.comm)}); }
async function ownerSystem(db,chat) { return send(chat,"⚙️ سیستم",{reply_markup:menu(KB.system)}); }

async function plansText(db) {
  const a=await listPlans(db);
  if(!a.length) return "هیچ پلنی وجود ندارد.";
  return a.map(p=>`#${p.id} | ${p.name} | ${p.volume} | ${money(p.price)} | ${p.active?"فعال":"غیرفعال"}`).join("\n");
}

async function startPlanCreate(db,chat,id) {
  await setState(db,id,"PLAN_NAME");
  return send(chat,"➕ نام پلن را بفرست:\nمثال: اقتصادی");
}
async function createPlanStep(db,chat,id,u,text) {
  const d=stateData(u);
  if(u.state==="PLAN_NAME") {
    d.name=text; await setState(db,id,"PLAN_VOLUME",d);
    return send(chat,"📦 حجم پلن را بفرست:\nمثال: 50GB");
  }
  if(u.state==="PLAN_VOLUME") {
    d.volume=text; await setState(db,id,"PLAN_PRICE",d);
    return send(chat,"💵 قیمت را فقط به عدد تومان بفرست:\nمثال: 120000");
  }
  if(u.state==="PLAN_PRICE") {
    const price=Number(text.replace(/[,٬]/g,""));
    if(!Number.isFinite(price)||price<=0) return send(chat,"❌ قیمت نامعتبر است. فقط عدد بفرست.");
    await db.prepare(`INSERT INTO plans(name,volume,price,created_at) VALUES(?,?,?,?)`).bind(d.name,d.volume,price,Date.now()).run();
    await clearState(db,id); await log(db,id,"create_plan",JSON.stringify({name:d.name,volume:d.volume,price}));
    return send(chat,`✅ پلن ساخته شد.\n\n${d.name} | ${d.volume} | ${money(price)}`,{reply_markup:menu(KB.sales)});
  }
}

async function startPlanEdit(db,chat,id) {
  const t=await plansText(db);
  await setState(db,id,"EDIT_PLAN_SELECT");
  return send(chat,`✏️ شناسه پلنی که می‌خواهی ویرایش شود را بفرست.\n\n${t}`);
}
async function editPlanStep(db,chat,id,u,text) {
  const d=stateData(u);
  if(u.state==="EDIT_PLAN_SELECT"){
    const p=await db.prepare(`SELECT * FROM plans WHERE id=?`).bind(Number(text)).first();
    if(!p) return send(chat,"❌ پلن پیدا نشد.");
    d.id=p.id; await setState(db,id,"EDIT_PLAN_DATA",d);
    return send(chat,`✏️ اطلاعات جدید را به شکل زیر بفرست:\nنام | حجم | قیمت\n\nفعلی: ${p.name} | ${p.volume} | ${p.price}`);
  }
  if(u.state==="EDIT_PLAN_DATA"){
    const parts=text.split("|").map(x=>x.trim());
    if(parts.length!==3) return send(chat,"❌ فرمت اشتباه است. نمونه: اقتصادی | 50GB | 120000");
    const price=Number(parts[2].replace(/[,٬]/g,""));
    if(!parts[0]||!parts[1]||!Number.isFinite(price)||price<=0) return send(chat,"❌ اطلاعات نامعتبر است.");
    await db.prepare(`UPDATE plans SET name=?,volume=?,price=? WHERE id=?`).bind(parts[0],parts[1],price,d.id).run();
    await clearState(db,id); await log(db,id,"edit_plan",text);
    return send(chat,"✅ پلن ویرایش شد.",{reply_markup:menu(KB.sales)});
  }
}
async function startPlanDelete(db,chat,id) {
  await setState(db,id,"DELETE_PLAN");
  return send(chat,`🗑️ شناسه پلن را بفرست:\n\n${await plansText(db)}`);
}
async function deletePlanStep(db,chat,id,u,text) {
  const p=await db.prepare(`SELECT * FROM plans WHERE id=?`).bind(Number(text)).first();
  if(!p) return send(chat,"❌ پلن پیدا نشد.");
  await db.prepare(`UPDATE plans SET active=0 WHERE id=?`).bind(p.id).run();
  await clearState(db,id); await log(db,id,"delete_plan",String(p.id));
  return send(chat,"✅ پلن حذف شد.",{reply_markup:menu(KB.sales)});
}

async function discountCreate(db,chat,id) {
  await setState(db,id,"COUPON_CREATE");
  return send(chat,"➕ کد تخفیف را بفرست:\nمثال: Parsa20");
}
async function couponStep(db,chat,id,u,text) {
  if(u.state==="COUPON_CREATE"){
    const code=text.trim().toUpperCase();
    const old=await db.prepare(`SELECT 1 FROM coupons WHERE code=?`).bind(code).first();
    if(old) return send(chat,"❌ این کد قبلاً وجود دارد.");
    await setState(db,id,"COUPON_PERCENT",{code});
    return send(chat,"📊 درصد تخفیف را بفرست:\nمثال: 20");
  }
  if(u.state==="COUPON_PERCENT"){
    const d=stateData(u), p=Number(text);
    if(!Number.isInteger(p)||p<1||p>100) return send(chat,"❌ درصد باید بین 1 تا 100 باشد.");
    d.percent=p; await setState(db,id,"COUPON_MAX",d);
    return send(chat,"🔢 حداکثر تعداد استفاده را بفرست.\nبرای فقط یک‌بار: 1");
  }
  if(u.state==="COUPON_MAX"){
    const d=stateData(u), max=Number(text);
    if(!Number.isInteger(max)||max<1) return send(chat,"❌ تعداد نامعتبر است.");
    d.max=max; await setState(db,id,"COUPON_USER",d);
    return send(chat,"👤 اگر کد مخصوص یک کاربر است، آیدی عددی او را بفرست؛ در غیر این صورت 0");
  }
  if(u.state==="COUPON_USER"){
    const d=stateData(u), user=text.trim();
    d.user=(user==="0"?"":user); await setState(db,id,"COUPON_VOLUME",d);
    return send(chat,"📦 حجم اختصاصی را بفرست یا 0 برای همه حجم‌ها.");
  }
  if(u.state==="COUPON_VOLUME"){
    const d=stateData(u), volume=text.trim();
    try {
      await db.prepare(`INSERT INTO coupons(code,percent,max_uses,user_id,volume,created_at) VALUES(?,?,?,?,?,?)`)
        .bind(d.code,d.percent,d.max,d.user||null,volume==="0"?"":volume,Date.now()).run();
    } catch { return send(chat,"❌ ساخت کد انجام نشد؛ شاید کد تکراری باشد."); }
    await clearState(db,id); await log(db,id,"create_coupon",d.code);
    return send(chat,`✅ کد تخفیف ساخته شد.\n\nکد: ${d.code}\nدرصد: ${d.percent}%\nسقف استفاده: ${d.max}\nکاربر: ${d.user||"همه"}\nحجم: ${volume==="0"?"همه":volume}`,{reply_markup:menu(KB.discount)});
  }
}
async function couponList(db,chat) {
  const a=(await db.prepare(`SELECT * FROM coupons ORDER BY id DESC`).all()).results||[];
  if(!a.length) return send(chat,"📋 کدی وجود ندارد.");
  let t="📋 کدهای تخفیف\n\n";
  for(const c of a)t+=`#${c.id} | ${c.code} | ${c.percent}% | ${c.used_count}/${c.max_uses} | ${c.active?"فعال":"باطل"} | کاربر: ${c.user_id||"همه"} | حجم: ${c.volume||"همه"}\n`;
  return send(chat,t);
}
async function couponRevoke(db,chat,id) {
  await setState(db,id,"REVOKE_COUPON");
  return send(chat,`❌ شناسه کد تخفیف را بفرست:\n\n${await couponListText(db)}`);
}
async function couponListText(db) {
  const a=(await db.prepare(`SELECT id,code,active FROM coupons ORDER BY id DESC`).all()).results||[];
  return a.length?a.map(c=>`#${c.id} | ${c.code} | ${c.active?"فعال":"باطل"}`).join("\n"):"کدی وجود ندارد.";
}
async function revokeStep(db,chat,id,text) {
  const c=await db.prepare(`SELECT * FROM coupons WHERE id=?`).bind(Number(text)).first();
  if(!c)return send(chat,"❌ کد پیدا نشد.");
  await db.prepare(`UPDATE coupons SET active=0 WHERE id=?`).bind(c.id).run();
  await clearState(db,id); await log(db,id,"revoke_coupon",c.code);
  return send(chat,"✅ کد باطل شد.",{reply_markup:menu(KB.discount)});
}
async function couponStats(db,chat) {
  const a=(await db.prepare(`SELECT code,percent,max_uses,used_count,active FROM coupons ORDER BY used_count DESC`).all()).results||[];
  if(!a.length)return send(chat,"آماری وجود ندارد.");
  return send(chat,"📊 آمار استفاده از کدها\n\n"+a.map(c=>`${c.code} | ${c.percent}% | ${c.used_count}/${c.max_uses} | ${c.active?"فعال":"باطل"}`).join("\n"));
}

async function validateCoupon(db, code, userId, volume) {
  if(!code)return null;
  const c=await db.prepare(`SELECT * FROM coupons WHERE code=? AND active=1`).bind(code.trim().toUpperCase()).first();
  if(!c || c.used_count>=c.max_uses) return null;
  if(c.user_id && c.user_id!==uid(userId)) return null;
  if(c.volume && c.volume!==volume) return null;
  return c;
}

async function orderStart(db,chat,id,planId) {
  const p=await db.prepare(`SELECT * FROM plans WHERE id=? AND active=1`).bind(Number(planId)).first();
  if(!p)return answerCallback("", "پلن ناموجود است");
  await setState(db,id,"COUPON_ENTER",{planId:p.id});
  return send(chat,`🛒 پلن انتخاب شد:\n${p.name} | ${p.volume} | ${money(p.price)}\n\n🎟️ اگر کد تخفیف داری بفرست؛ اگر نداری «ندارم» بنویس.`);
}

async function couponCustomerStep(db,chat,id,u,text) {
  const d=stateData(u), p=await db.prepare(`SELECT * FROM plans WHERE id=?`).bind(d.planId).first();
  if(!p){await clearState(db,id);return send(chat,"❌ پلن پیدا نشد.");}
  let coupon=null;
  if(text.trim()!=="ندارم") coupon=await validateCoupon(db,text,id,p.volume);
  if(text.trim()!=="ندارم"&&!coupon) return send(chat,"❌ کد تخفیف نامعتبر یا غیرقابل استفاده است. دوباره بفرست یا «ندارم» بنویس.");
  const discount=coupon?Math.floor(p.price*coupon.percent/100):0;
  const amount=p.price-discount;
  const r=await db.prepare(`INSERT INTO orders(user_id,plan_id,plan_name,volume,amount,discount_code,discount_percent,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(uid(id),p.id,p.name,p.volume,amount,coupon?.code||"",coupon?.percent||0,"pending",Date.now(),Date.now()).run();
  const oid=r.meta?.last_row_id;
  if(coupon) await db.prepare(`UPDATE coupons SET used_count=used_count+1 WHERE id=?`).bind(coupon.id).run();
  await setState(db,id,"WAIT_RECEIPT",{orderId:oid});
  return send(chat,`🧾 سفارش #${oid}\n\nپلن: ${p.name}\nحجم: ${p.volume}\nقیمت اصلی: ${money(p.price)}\nتخفیف: ${coupon?coupon.percent+"%":"ندارد"}\n💵 مبلغ پرداخت: ${money(amount)}\n\n📸 حالا رسید پرداخت را به صورت عکس یا فایل PDF بفرست.`);
}

async function receiptStep(db,chat,id,u,msg) {
  const d=stateData(u), oid=d.orderId;
  let file_id=null,type=null;
  if(msg.photo?.length){file_id=msg.photo[msg.photo.length-1].file_id;type="photo";}
  else if(msg.document){file_id=msg.document.file_id;type="document";}
  if(!file_id)return send(chat,"📸 لطفاً رسید را به صورت عکس یا PDF بفرست.");
  const o=await db.prepare(`SELECT * FROM orders WHERE id=? AND user_id=?`).bind(oid,uid(id)).first();
  if(!o)return send(chat,"❌ سفارش پیدا نشد.");
  await db.prepare(`UPDATE orders SET receipt_file_id=?,receipt_type=?,updated_at=? WHERE id=?`).bind(file_id,type,Date.now(),oid).run();
  await clearState(db,id);
  const ownerUser=await getUser(db,id);
  const caption=`🧾 رسید جدید\n\nسفارش: #${o.id}\n👤 آیدی: ${id}\n🔹 یوزرنیم: ${ownerUser?.username?`@${ownerUser.username}`:"ندارد"}\n📦 ${o.plan_name} | ${o.volume}\n💵 ${money(o.amount)}\n${o.discount_code?`🎟️ ${o.discount_code} (${o.discount_percent}%)\n`:""}\nیکی را انتخاب کنید:`;
  const kb=inline([[{text:"✅ تأیید",callback_data:`approve:${o.id}`},{text:"❌ رد",callback_data:`reject:${o.id}`}],[{text:"🔍 سفارش",callback_data:`order:${o.id}`}]]);

  if(type==="photo") await tg("sendPhoto",{chat_id:OWNER_ID,photo:file_id,caption,reply_markup:kb});
  else await tg("sendDocument",{chat_id:OWNER_ID,document:file_id,caption,reply_markup:kb});
  await send(chat,"✅ رسید دریافت شد.\n⏳ پس از بررسی مالک، نتیجه برایت ارسال می‌شود.");
}

async function approveStart(db,chat,oid) {
  const o=await db.prepare(`SELECT * FROM orders WHERE id=?`).bind(oid).first();
  if(!o)return send(chat,"❌ سفارش پیدا نشد.");
  if(o.status!=="pending")return send(chat,`این سفارش قبلاً ${statusFa(o.status)} شده است.`);
  await setState(db,OWNER_ID,"APPROVE_URL",{orderId:oid});
  return send(chat,`✅ سفارش #${oid} آماده تأیید است.\n\n🔗 حالا لینک اشتراک/کانفیگ این مشتری را بفرست.`);
}
async function approveUrl(db,chat,id,u,text) {
  const d=stateData(u), o
