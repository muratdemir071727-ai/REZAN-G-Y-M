const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

const app = express();
const PORT = 3000;

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");
const UPLOAD_DIR = path.join(ROOT_DIR, "uploads");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   VERİTABANI
========================================================= */

function createDefaultDatabase() {
    return {
        admin: {
            passwordHash: ""
        },

        products: [],

        categories: [
            {
                id: "cat-kadin",
                name: "Kadın"
            },
            {
                id: "cat-erkek",
                name: "Erkek"
            },
            {
                id: "cat-cocuk",
                name: "Çocuk"
            },
            {
                id: "cat-ayakkabi",
                name: "Ayakkabı"
            },
            {
                id: "cat-aksesuar",
                name: "Aksesuar"
            }
        ],

        orders: [],

        paymentInfo: {
            bankName: "",
            accountName: "",
            iban: "",
            description: ""
        }
    };
}

function loadDB() {
    let db;

    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, "utf8");
            db = JSON.parse(raw);
        } else {
            db = createDefaultDatabase();
        }
    } catch (error) {
        console.error("Veritabanı okunamadı:", error);
        db = createDefaultDatabase();
    }

    if (!db || typeof db !== "object") {
        db = createDefaultDatabase();
    }

    if (!db.admin) {
        db.admin = {
            passwordHash: ""
        };
    }

    if (!Array.isArray(db.products)) {
        db.products = [];
    }

    if (!Array.isArray(db.orders)) {
        db.orders = [];
    }

    if (!Array.isArray(db.categories)) {
        db.categories = [];
    }

    if (!db.paymentInfo) {
        db.paymentInfo = {
            bankName: "",
            accountName: "",
            iban: "",
            description: ""
        };
    }

    if (typeof db.paymentInfo.bankName !== "string") {
        db.paymentInfo.bankName = "";
    }

    if (typeof db.paymentInfo.accountName !== "string") {
        db.paymentInfo.accountName = "";
    }

    if (typeof db.paymentInfo.iban !== "string") {
        db.paymentInfo.iban = "";
    }

    if (typeof db.paymentInfo.description !== "string") {
        db.paymentInfo.description = "";
    }

    /*
      Eski ürünlerde kategori varsa ve categories boşsa
      mevcut kategorileri otomatik oluştur.
    */
    if (db.categories.length === 0 && db.products.length > 0) {
        const names = [];

        for (const product of db.products) {
            if (
                product.category &&
                typeof product.category === "string" &&
                product.category.trim()
            ) {
                const name = product.category.trim();

                if (!names.includes(name)) {
                    names.push(name);
                }
            }
        }

        for (const name of names) {
            db.categories.push({
                id: createId("cat"),
                name
            });
        }
    }

    return db;
}

let db = loadDB();

function saveDB() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(db, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Veritabanı kaydedilemedi:", error);
    }
}

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function createId(prefix = "id") {
    return (
        prefix +
        "_" +
        Date.now().toString(36) +
        "_" +
        crypto.randomBytes(5).toString("hex")
    );
}

function cleanText(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value).trim();
}

function normalizeTurkish(value) {
    return cleanText(value).toLocaleLowerCase("tr-TR");
}

/* =========================================================
   ŞİFRE SİSTEMİ
========================================================= */

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");

    const hash = crypto
        .scryptSync(password, salt, 64)
        .toString("hex");

    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    try {
        if (!storedHash || !storedHash.includes(":")) {
            return false;
        }

        const parts = storedHash.split(":");

        const salt = parts[0];
        const originalHash = parts[1];

        const newHash = crypto
            .scryptSync(password, salt, 64)
            .toString("hex");

        return crypto.timingSafeEqual(
            Buffer.from(originalHash, "hex"),
            Buffer.from(newHash, "hex")
        );
    } catch {
        return false;
    }
}

/*
  İlk giriş şifresi:
  RZG2026
*/
if (!db.admin.passwordHash) {
    db.admin.passwordHash = hashPassword("RZG2026");
    saveDB();

    console.log("İlk admin şifresi oluşturuldu: RZG2026");
}

/* =========================================================
   OTURUM SİSTEMİ
========================================================= */

const sessions = new Map();

function createSession() {
    return crypto.randomBytes(32).toString("hex");
}

function getSessionToken(req) {
    const cookieHeader = req.headers.cookie || "";

    const cookies = cookieHeader.split(";");

    for (const cookie of cookies) {
        const parts = cookie.trim().split("=");

        if (parts[0] === "rezan_admin") {
            return parts.slice(1).join("=");
        }
    }

    return null;
}

function requireAdmin(req, res, next) {
    const token = getSessionToken(req);

    if (!token || !sessions.has(token)) {
        return res.status(401).json({
            success: false,
            message: "Yetkisiz erişim."
        });
    }

    next();
}

/* =========================================================
   MULTER - ÜRÜN GÖRSELLERİ
========================================================= */

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOAD_DIR);
    },

    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();

        const safeName =
            Date.now() +
            "_" +
            crypto.randomBytes(6).toString("hex") +
            ext;

        cb(null, safeName);
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 20
    },

    fileFilter: function (req, file, cb) {
        const allowed = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif"
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(
                new Error(
                    "Sadece JPG, PNG, WEBP veya GIF görseller yüklenebilir."
                )
            );
        }

        cb(null, true);
    }
});

/* =========================================================
   ADMIN GİRİŞ
========================================================= */

app.post("/api/admin/login", (req, res) => {
    const password = cleanText(req.body.password);

    if (!password) {
        return res.status(400).json({
            success: false,
            message: "Şifre girin."
        });
    }

    if (!verifyPassword(password, db.admin.passwordHash)) {
        return res.status(401).json({
            success: false,
            message: "Şifre yanlış."
        });
    }

    const token = createSession();

    sessions.set(token, {
        createdAt: Date.now()
    });

    res.setHeader(
        "Set-Cookie",
        "rezan_admin=" +
        token +
        "; HttpOnly; Path=/; SameSite=Lax"
    );

    res.json({
        success: true,
        message: "Giriş başarılı."
    });
});

/* =========================================================
   ADMIN ÇIKIŞ
========================================================= */

app.post("/api/admin/logout", (req, res) => {
    const token = getSessionToken(req);

    if (token) {
        sessions.delete(token);
    }

    res.setHeader(
        "Set-Cookie",
        "rezan_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
    );

    res.json({
        success: true
    });
});

/* =========================================================
   ADMIN SESSION
========================================================= */

app.get("/api/admin/session", (req, res) => {
    const token = getSessionToken(req);

    res.json({
        loggedIn: !!(token && sessions.has(token))
    });
});

/* =========================================================
   ADMIN ŞİFRE DEĞİŞTİR
========================================================= */

app.post(
    "/api/admin/change-password",
    requireAdmin,
    (req, res) => {
        const oldPassword = cleanText(req.body.oldPassword);
        const newPassword = cleanText(req.body.newPassword);

        if (!oldPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Eski ve yeni şifre gereklidir."
            });
        }

        if (!verifyPassword(oldPassword, db.admin.passwordHash)) {
            return res.status(401).json({
                success: false,
                message: "Eski şifre yanlış."
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Yeni şifre en az 6 karakter olmalıdır."
            });
        }

        db.admin.passwordHash = hashPassword(newPassword);

        saveDB();

        res.json({
            success: true,
            message: "Şifre değiştirildi."
        });
    }
);

/* =========================================================
   KATEGORİLER - LİSTELE
========================================================= */

app.get("/api/categories", (req, res) => {
    res.json({
        success: true,
        categories: db.categories
    });
});

/* =========================================================
   KATEGORİ EKLE
========================================================= */

app.post(
    "/api/categories",
    requireAdmin,
    (req, res) => {
        const name = cleanText(req.body.name);

        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Kategori adı girin."
            });
        }

        if (name.length > 50) {
            return res.status(400).json({
                success: false,
                message: "Kategori adı en fazla 50 karakter olabilir."
            });
        }

        const normalizedName = normalizeTurkish(name);

        const exists = db.categories.some(
            category =>
                normalizeTurkish(category.name) === normalizedName
        );

        if (exists) {
            return res.status(409).json({
                success: false,
                message: "Bu kategori zaten var."
            });
        }

        const category = {
            id: createId("cat"),
            name
        };

        db.categories.push(category);

        saveDB();

        res.json({
            success: true,
            category
        });
    }
);

/* =========================================================
   KATEGORİ SİL
========================================================= */

app.delete(
    "/api/categories/:id",
    requireAdmin,
    (req, res) => {
        const id = req.params.id;

        const category = db.categories.find(
            item => item.id === id
        );

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "Kategori bulunamadı."
            });
        }

        const usedProducts = db.products.filter(
            product =>
                normalizeTurkish(product.category) ===
                normalizeTurkish(category.name)
        );

        if (usedProducts.length > 0) {
            return res.status(400).json({
                success: false,
                message:
                    "Bu kategori " +
                    usedProducts.length +
                    " üründe kullanılıyor. Önce ürünlerin kategorisini değiştirin."
            });
        }

        db.categories = db.categories.filter(
            item => item.id !== id
        );

        saveDB();

        res.json({
            success: true,
            message: "Kategori silindi."
        });
    }
);

/* =========================================================
   ÜRÜNLERİ GETİR
========================================================= */

app.get("/api/products", (req, res) => {
    res.json({
        success: true,
        products: db.products
    });
});

/* =========================================================
   ÜRÜN EKLE
========================================================= */

app.post(
    "/api/products",
    requireAdmin,
    (req, res) => {
        const body = req.body || {};

        const name = cleanText(body.name);
        const category = cleanText(body.category);
        const description = cleanText(body.description);

        const price = Number(body.price);
        const oldPrice =
            body.oldPrice === "" ||
            body.oldPrice === null ||
            body.oldPrice === undefined
                ? 0
                : Number(body.oldPrice);

        const stock =
            body.stock === "" ||
            body.stock === null ||
            body.stock === undefined
                ? 0
                : Number(body.stock);

        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Ürün adı gereklidir."
            });
        }

        if (!Number.isFinite(price) || price < 0) {
            return res.status(400).json({
                success: false,
                message: "Geçerli bir ürün fiyatı girin."
            });
        }

        const images = Array.isArray(body.images)
            ? body.images.filter(Boolean)
            : [];

        let sizes = [];

        if (Array.isArray(body.sizes)) {
            sizes = body.sizes
                .map(size => ({
                    name: cleanText(size.name),
                    stock: Math.max(
                        0,
                        Number(size.stock) || 0
                    )
                }))
                .filter(size => size.name);
        }

        const product = {
            id: createId("product"),
            name,
            category,
            price,
            oldPrice:
                Number.isFinite(oldPrice) && oldPrice >= 0
                    ? oldPrice
                    : 0,
            stock:
                Number.isFinite(stock) && stock >= 0
                    ? stock
                    : 0,
            sizes,
            images,
            description,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        db.products.push(product);

        saveDB();

        res.json({
            success: true,
            product
        });
    }
);

/* =========================================================
   ÜRÜN GÜNCELLE
========================================================= */

app.put(
    "/api/products/:id",
    requireAdmin,
    (req, res) => {
        const product = db.products.find(
            item => item.id === req.params.id
        );

        if (!product) {
            return res.status(404).json({
                success: false,
                message: "Ürün bulunamadı."
            });
        }

        const body = req.body || {};

        const name = cleanText(body.name);
        const category = cleanText(body.category);
        const description = cleanText(body.description);

        const price = Number(body.price);

        const oldPrice =
            body.oldPrice === "" ||
            body.oldPrice === null ||
            body.oldPrice === undefined
                ? 0
                : Number(body.oldPrice);

        const stock =
            body.stock === "" ||
            body.stock === null ||
            body.stock === undefined
                ? 0
                : Number(body.stock);

        if (!name) {
            return res.status(400).json({
                success: false,
                message: "Ürün adı gereklidir."
            });
        }

        if (!Number.isFinite(price) || price < 0) {
            return res.status(400).json({
                success: false,
                message: "Geçerli bir fiyat girin."
            });
        }

        const images = Array.isArray(body.images)
            ? body.images.filter(Boolean)
            : product.images || [];

        let sizes = [];

        if (Array.isArray(body.sizes)) {
            sizes = body.sizes
                .map(size => ({
                    name: cleanText(size.name),
                    stock: Math.max(
                        0,
                        Number(size.stock) || 0
                    )
                }))
                .filter(size => size.name);
        }

        product.name = name;
        product.category = category;
        product.description = description;
        product.price = price;

        product.oldPrice =
            Number.isFinite(oldPrice) && oldPrice >= 0
                ? oldPrice
                : 0;

        product.stock =
            Number.isFinite(stock) && stock >= 0
                ? stock
                : 0;

        product.sizes = sizes;
        product.images = images;
        product.updatedAt = new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            product
        });
    }
);

/* =========================================================
   ÜRÜN SİL
========================================================= */

app.delete(
    "/api/products/:id",
    requireAdmin,
    (req, res) => {
        const index = db.products.findIndex(
            item => item.id === req.params.id
        );

        if (index === -1) {
            return res.status(404).json({
                success: false,
                message: "Ürün bulunamadı."
            });
        }

        db.products.splice(index, 1);

        saveDB();

        res.json({
            success: true,
            message: "Ürün silindi."
        });
    }
);

/* =========================================================
   GÖRSEL YÜKLE
========================================================= */

app.post(
    "/api/upload",
    requireAdmin,
    upload.array("images", 20),
    (req, res) => {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Görsel seçilmedi."
            });
        }

        const files = req.files.map(file => ({
            filename: file.filename,
            originalName: file.originalname,
            url: "/uploads/" + file.filename,
            size: file.size,
            mimetype: file.mimetype
        }));

        res.json({
            success: true,
            files,
            images: files
        });
    }
);

/* =========================================================
   GÖRSEL SİL
========================================================= */

app.delete(
    "/api/upload",
    requireAdmin,
    (req, res) => {
        const filename = cleanText(req.body.filename);

        if (!filename) {
            return res.status(400).json({
                success: false,
                message: "Dosya adı belirtilmedi."
            });
        }

        const safeFilename = path.basename(filename);

        const filePath = path.join(
            UPLOAD_DIR,
            safeFilename
        );

        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (error) {
                console.error(
                    "Görsel silinemedi:",
                    error
                );
            }
        }

        res.json({
            success: true
        });
    }
);

/* =========================================================
   ÖDEME BİLGİLERİ
========================================================= */

app.get("/api/payment-info", (req, res) => {
    res.json({
        success: true,
        paymentInfo: db.paymentInfo
    });
});

app.put(
    "/api/payment-info",
    requireAdmin,
    (req, res) => {
        const body = req.body || {};

        db.paymentInfo = {
            bankName: cleanText(body.bankName),
            accountName: cleanText(body.accountName),
            iban: cleanText(body.iban),
            description: cleanText(body.description)
        };

        saveDB();

        res.json({
            success: true,
            paymentInfo: db.paymentInfo
        });
    }
);

/* =========================================================
   SİPARİŞ OLUŞTUR
========================================================= */

app.post("/api/orders", (req, res) => {
    const body = req.body || {};

    const customer = body.customer || {};
    const incomingItems = Array.isArray(body.items)
        ? body.items
        : [];

    if (incomingItems.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Sepet boş."
        });
    }

    const requiredCustomerFields = [
        "name",
        "phone",
        "email",
        "city",
        "district",
        "neighborhood",
        "address",
        "buildingNo",
        "apartmentNo",
        "postalCode"
    ];

    for (const field of requiredCustomerFields) {
        if (!cleanText(customer[field])) {
            return res.status(400).json({
                success: false,
                message:
                    "Lütfen tüm teslimat bilgilerini doldurun."
            });
        }
    }

    const orderItems = [];
    let total = 0;

    /*
      Önce bütün ürünleri kontrol ediyoruz.
      Böylece bir ürün bile stokta yoksa sipariş
      yarım şekilde oluşmuyor.
    */

    for (const incoming of incomingItems) {
        const productId = cleanText(incoming.productId);
        const size = cleanText(incoming.size);

        const quantity = Math.floor(
            Number(incoming.quantity) || 0
        );

        if (!productId || quantity <= 0) {
            return res.status(400).json({
                success: false,
                message: "Sepette geçersiz ürün var."
            });
        }

        const product = db.products.find(
            item => item.id === productId
        );

        if (!product) {
            return res.status(404).json({
                success: false,
                message:
                    "Sepetteki ürün artık bulunamıyor."
            });
        }

        let availableStock = Number(product.stock) || 0;

        let selectedSize = null;

        if (
            Array.isArray(product.sizes) &&
            product.sizes.length > 0
        ) {
            selectedSize = product.sizes.find(
                item =>
                    normalizeTurkish(item.name) ===
                    normalizeTurkish(size)
            );

            if (!selectedSize) {
                return res.status(400).json({
                    success: false,
                    message:
                        product.name +
                        " için beden/numara seçin."
                });
            }

            availableStock =
                Number(selectedSize.stock) || 0;
        }

        if (availableStock < quantity) {
            return res.status(400).json({
                success: false,
                message:
                    product.name +
                    " için yeterli stok yok."
            });
        }

        const itemTotal =
            Number(product.price) * quantity;

        total += itemTotal;

        orderItems.push({
            productId: product.id,
            name: product.name,
            image:
                Array.isArray(product.images) &&
                product.images.length > 0
                    ? product.images[0]
                    : "",
            size: size || "",
            quantity,
            price: Number(product.price),
            total: itemTotal
        });
    }

    /*
      Stokları şimdi düşürüyoruz.
    */

    for (const item of orderItems) {
        const product = db.products.find(
            p => p.id === item.productId
        );

        if (!product) {
            continue;
        }

        if (
            Array.isArray(product.sizes) &&
            product.sizes.length > 0 &&
            item.size
        ) {
            const size = product.sizes.find(
                s =>
                    normalizeTurkish(s.name) ===
                    normalizeTurkish(item.size)
            );

            if (size) {
                size.stock =
                    Math.max(
                        0,
                        Number(size.stock) -
                        item.quantity
                    );
            }

            product.stock =
                product.sizes.reduce(
                    (sum, s) =>
                        sum +
                        (Number(s.stock) || 0),
                    0
                );
        } else {
            product.stock =
                Math.max(
                    0,
                    Number(product.stock) -
                    item.quantity
                );
        }
    }

    const order = {
        id: "RZ-" +
            new Date()
                .toISOString()
                .replace(/\D/g, "")
                .slice(0, 14) +
            "-" +
            crypto
                .randomBytes(3)
                .toString("hex")
                .toUpperCase(),

        customer: {
            name: cleanText(customer.name),
            phone: cleanText(customer.phone),
            email: cleanText(customer.email),
            city: cleanText(customer.city),
            district: cleanText(customer.district),
            neighborhood: cleanText(
                customer.neighborhood
            ),
            address: cleanText(customer.address),
            buildingNo: cleanText(
                customer.buildingNo
            ),
            apartmentNo: cleanText(
                customer.apartmentNo
            ),
            postalCode: cleanText(
                customer.postalCode
            ),
            note: cleanText(customer.note)
        },

        items: orderItems,

        total,

        paymentStatus: "pending",

        orderStatus: "Ödeme bekleniyor",

        shipping: {
            company: "",
            trackingNumber: ""
        },

        createdAt: new Date().toISOString(),

        updatedAt: new Date().toISOString()
    };

    db.orders.unshift(order);

    saveDB();

    res.json({
        success: true,
        order
    });
});

/* =========================================================
   SİPARİŞ GETİR
========================================================= */

app.get("/api/orders/:id", (req, res) => {
    const order = db.orders.find(
        item => item.id === req.params.id
    );

    if (!order) {
        return res.status(404).json({
            success: false,
            message: "Sipariş bulunamadı."
        });
    }

    res.json({
        success: true,
        order
    });
});

/* =========================================================
   TÜM SİPARİŞLER
========================================================= */

app.get(
    "/api/orders",
    requireAdmin,
    (req, res) => {
        res.json({
            success: true,
            orders: db.orders
        });
    }
);

/* =========================================================
   ÖDEMEYİ ONAYLA
========================================================= */

app.post(
    "/api/orders/:id/confirm-payment",
    requireAdmin,
    (req, res) => {
        const order = db.orders.find(
            item => item.id === req.params.id
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Sipariş bulunamadı."
            });
        }

        order.paymentStatus = "paid";
        order.orderStatus = "Kargoya hazırlanıyor";
        order.updatedAt = new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   ÖDEME GELMEDİ
========================================================= */

app.post(
    "/api/orders/:id/payment-not-received",
    requireAdmin,
    (req, res) => {
        const order = db.orders.find(
            item => item.id === req.params.id
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Sipariş bulunamadı."
            });
        }

        order.paymentStatus = "not_received";
        order.orderStatus = "Ödeme alınmadı";
        order.updatedAt = new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   SİPARİŞ İPTAL
========================================================= */

app.post(
    "/api/orders/:id/cancel",
    requireAdmin,
    (req, res) => {
        const order = db.orders.find(
            item => item.id === req.params.id
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Sipariş bulunamadı."
            });
        }

        /*
          Daha önce iptal edilmediyse stokları geri ekle.
        */

        if (order.orderStatus !== "İptal edildi") {
            for (const item of order.items || []) {
                const product = db.products.find(
                    p => p.id === item.productId
                );

                if (!product) {
                    continue;
                }

                if (
                    Array.isArray(product.sizes) &&
                    product.sizes.length > 0 &&
                    item.size
                ) {
                    const size = product.sizes.find(
                        s =>
                            normalizeTurkish(s.name) ===
                            normalizeTurkish(item.size)
                    );

                    if (size) {
                        size.stock =
                            (Number(size.stock) || 0) +
                            (Number(item.quantity) || 0);
                    }

                    product.stock =
                        product.sizes.reduce(
                            (sum, s) =>
                                sum +
                                (Number(s.stock) || 0),
                            0
                        );
                } else {
                    product.stock =
                        (Number(product.stock) || 0) +
                        (Number(item.quantity) || 0);
                }
            }
        }

        order.paymentStatus = "cancelled";
        order.orderStatus = "İptal edildi";
        order.updatedAt = new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   KARGO BİLGİSİ EKLE
========================================================= */

app.post(
    "/api/orders/:id/shipping",
    requireAdmin,
    (req, res) => {
        const order = db.orders.find(
            item => item.id === req.params.id
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Sipariş bulunamadı."
            });
        }

        const company = cleanText(
            req.body.company
        );

        const trackingNumber = cleanText(
            req.body.trackingNumber
        );

        if (!company || !trackingNumber) {
            return res.status(400).json({
                success: false,
                message:
                    "Kargo firması ve takip numarası gereklidir."
            });
        }

        order.shipping = {
            company,
            trackingNumber
        };

        order.orderStatus = "Kargoya verildi";
        order.updatedAt = new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   KARGO BİLGİSİ SİL
========================================================= */

app.delete(
    "/api/orders/:id/shipping",
    requireAdmin,
    (req, res) => {
        const order = db.orders.find(
            item => item.id === req.params.id
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Sipariş bulunamadı."
            });
        }

        order.shipping = {
            company: "",
            trackingNumber: ""
        };

        if (order.paymentStatus === "paid") {
            order.orderStatus =
                "Kargoya hazırlanıyor";
        } else {
            order.orderStatus =
                "Ödeme bekleniyor";
        }

        order.updatedAt = new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   UPLOADS KLASÖRÜ
========================================================= */

app.use(
    "/uploads",
    express.static(UPLOAD_DIR)
);

/* =========================================================
   ADMIN SAYFASI
========================================================= */

app.get("/admin", (req, res) => {
    res.setHeader(
        "X-Robots-Tag",
        "noindex, nofollow, noarchive"
    );

    res.sendFile(
        path.join(ROOT_DIR, "admin.html")
    );
});

/* =========================================================
   ANA SAYFA
========================================================= */

app.get("/", (req, res) => {
    res.sendFile(
        path.join(ROOT_DIR, "index.html")
    );
});

/* =========================================================
   STATİK DOSYALAR
========================================================= */

app.use(
    express.static(ROOT_DIR, {
        index: false
    })
);

/* =========================================================
   MULTER HATASI
========================================================= */

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message:
                "Görsel yükleme hatası: " +
                error.message
        });
    }

    if (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Sunucu hatası."
        });
    }

    next();
});

/* =========================================================
   SUNUCU
========================================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log(
        "REZAN GİYİM çalışıyor: http://localhost:" +
        PORT
    );

    console.log(
        "Admin paneli: http://localhost:" +
        PORT +
        "/admin"
    );
});