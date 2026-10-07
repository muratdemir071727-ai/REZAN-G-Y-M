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

app.use(express.json({ limit: "10mb" }));
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
        },

        homepage: {
            slides: []
        }
    };
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
    if (
        value === undefined ||
        value === null
    ) {
        return "";
    }

    return String(value).trim();
}

function normalizeTurkish(value) {
    return cleanText(value).toLocaleLowerCase("tr-TR");
}

function normalizeCategories(product) {
    let categories = [];

    if (Array.isArray(product.categories)) {
        categories = product.categories
            .map(item => cleanText(item))
            .filter(Boolean);
    }

    if (
        categories.length === 0 &&
        typeof product.category === "string" &&
        product.category.trim()
    ) {
        categories = [
            product.category.trim()
        ];
    }

    const unique = [];

    for (const category of categories) {
        if (
            !unique.some(
                item =>
                    normalizeTurkish(item) ===
                    normalizeTurkish(category)
            )
        ) {
            unique.push(category);
        }
    }

    return unique;
}

function normalizeProduct(product) {
    if (
        !product ||
        typeof product !== "object"
    ) {
        return null;
    }

    const categories =
        normalizeCategories(product);

    product.categories = categories;

    /*
      Eski sistemle uyumluluk.
      Eski frontend category kullanıyorsa
      çalışmaya devam eder.
    */
    product.category =
        categories.length > 0
            ? categories[0]
            : "";

    if (!Array.isArray(product.images)) {
        product.images = [];
    }

    if (!Array.isArray(product.sizes)) {
        product.sizes = [];
    }

    if (!Array.isArray(product.reviews)) {
        product.reviews = [];
    }

    product.reviews =
        product.reviews
            .filter(
                review =>
                    review &&
                    typeof review === "object"
            )
            .map(review => ({
                id:
                    cleanText(review.id) ||
                    createId("review"),

                name:
                    cleanText(review.name) ||
                    "Misafir",

                rating:
                    Math.min(
                        5,
                        Math.max(
                            1,
                            Number(review.rating) || 5
                        )
                    ),

                comment:
                    cleanText(review.comment),

                createdAt:
                    review.createdAt ||
                    new Date().toISOString()
            }));

    return product;
}

/* =========================================================
   VERİTABANI OKU
========================================================= */

function loadDB() {
    let db;

    try {
        if (fs.existsSync(DB_FILE)) {
            const raw =
                fs.readFileSync(
                    DB_FILE,
                    "utf8"
                );

            db = JSON.parse(raw);
        } else {
            db = createDefaultDatabase();
        }
    } catch (error) {
        console.error(
            "Veritabanı okunamadı:",
            error
        );

        db = createDefaultDatabase();
    }

    if (
        !db ||
        typeof db !== "object"
    ) {
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

    if (
        typeof db.paymentInfo.bankName !==
        "string"
    ) {
        db.paymentInfo.bankName = "";
    }

    if (
        typeof db.paymentInfo.accountName !==
        "string"
    ) {
        db.paymentInfo.accountName = "";
    }

    if (
        typeof db.paymentInfo.iban !==
        "string"
    ) {
        db.paymentInfo.iban = "";
    }

    if (
        typeof db.paymentInfo.description !==
        "string"
    ) {
        db.paymentInfo.description = "";
    }

    if (!db.homepage) {
        db.homepage = {
            slides: []
        };
    }

    if (
        !Array.isArray(
            db.homepage.slides
        )
    ) {
        db.homepage.slides = [];
    }

    /*
      MEVCUT ÜRÜNLERİ MİGRASYON YAP
    */

    for (const product of db.products) {
        normalizeProduct(product);
    }

    /*
      Eski kategorileri koru.
    */

    if (
        db.categories.length === 0 &&
        db.products.length > 0
    ) {
        const names = [];

        for (const product of db.products) {
            const categories =
                normalizeCategories(product);

            for (const name of categories) {
                if (
                    !names.some(
                        item =>
                            normalizeTurkish(item) ===
                            normalizeTurkish(name)
                    )
                ) {
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

    /*
      Vitrin verilerini temizle.
    */

    db.homepage.slides =
        db.homepage.slides
            .filter(
                slide =>
                    slide &&
                    typeof slide === "object"
            )
            .map((slide, index) => ({
                id:
                    cleanText(slide.id) ||
                    createId("slide"),

                image:
                    cleanText(slide.image),

                title:
                    cleanText(slide.title),

                subtitle:
                    cleanText(slide.subtitle),

                buttonText:
                    cleanText(slide.buttonText),

                buttonLink:
                    cleanText(slide.buttonLink),

                order:
                    Number.isFinite(
                        Number(slide.order)
                    )
                        ? Number(slide.order)
                        : index,

                active:
                    slide.active !== false,

                createdAt:
                    slide.createdAt ||
                    new Date().toISOString(),

                updatedAt:
                    slide.updatedAt ||
                    new Date().toISOString()
            }));

    db.homepage.slides.sort(
        (a, b) =>
            Number(a.order) -
            Number(b.order)
    );

    return db;
}

let db = loadDB();

function saveDB() {
    try {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(
                db,
                null,
                2
            ),
            "utf8"
        );
    } catch (error) {
        console.error(
            "Veritabanı kaydedilemedi:",
            error
        );
    }
}

/*
  Migration tamamlandıktan sonra
  hemen kaydet.
*/
saveDB();

/* =========================================================
   ŞİFRE
========================================================= */

function hashPassword(password) {
    const salt =
        crypto.randomBytes(16)
            .toString("hex");

    const hash =
        crypto.scryptSync(
            password,
            salt,
            64
        ).toString("hex");

    return `${salt}:${hash}`;
}

function verifyPassword(
    password,
    storedHash
) {
    try {
        if (
            !storedHash ||
            !storedHash.includes(":")
        ) {
            return false;
        }

        const parts =
            storedHash.split(":");

        const salt = parts[0];
        const originalHash =
            parts[1];

        const newHash =
            crypto.scryptSync(
                password,
                salt,
                64
            ).toString("hex");

        return crypto.timingSafeEqual(
            Buffer.from(
                originalHash,
                "hex"
            ),
            Buffer.from(
                newHash,
                "hex"
            )
        );
    } catch {
        return false;
    }
}

if (!db.admin.passwordHash) {
    db.admin.passwordHash =
        hashPassword("RZG2026");

    saveDB();

    console.log(
        "İlk admin şifresi oluşturuldu: RZG2026"
    );
}

/* =========================================================
   OTURUM
========================================================= */

const sessions = new Map();

function createSession() {
    return crypto
        .randomBytes(32)
        .toString("hex");
}

function getSessionToken(req) {
    const cookieHeader =
        req.headers.cookie || "";

    const cookies =
        cookieHeader.split(";");

    for (const cookie of cookies) {
        const parts =
            cookie.trim().split("=");

        if (
            parts[0] ===
            "rezan_admin"
        ) {
            return parts
                .slice(1)
                .join("=");
        }
    }

    return null;
}

function requireAdmin(
    req,
    res,
    next
) {
    const token =
        getSessionToken(req);

    if (
        !token ||
        !sessions.has(token)
    ) {
        return res
            .status(401)
            .json({
                success: false,
                message:
                    "Yetkisiz erişim."
            });
    }

    next();
}

/* =========================================================
   MULTER
========================================================= */

const storage =
    multer.diskStorage({
        destination:
            function (
                req,
                file,
                cb
            ) {
                cb(
                    null,
                    UPLOAD_DIR
                );
            },

        filename:
            function (
                req,
                file,
                cb
            ) {
                const ext =
                    path
                        .extname(
                            file.originalname
                        )
                        .toLowerCase();

                const safeName =
                    Date.now() +
                    "_" +
                    crypto
                        .randomBytes(6)
                        .toString("hex") +
                    ext;

                cb(
                    null,
                    safeName
                );
            }
    });

const upload =
    multer({
        storage,

        limits: {
            fileSize:
                10 * 1024 * 1024,
            files: 20
        },

        fileFilter:
            function (
                req,
                file,
                cb
            ) {
                const allowed = [
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                    "image/gif"
                ];

                if (
                    !allowed.includes(
                        file.mimetype
                    )
                ) {
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
   ADMIN LOGIN
========================================================= */

app.post(
    "/api/admin/login",
    (req, res) => {
        const password =
            cleanText(
                req.body.password
            );

        if (!password) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Şifre girin."
                });
        }

        if (
            !verifyPassword(
                password,
                db.admin.passwordHash
            )
        ) {
            return res
                .status(401)
                .json({
                    success: false,
                    message:
                        "Şifre yanlış."
                });
        }

        const token =
            createSession();

        sessions.set(
            token,
            {
                createdAt:
                    Date.now()
            }
        );

        res.setHeader(
            "Set-Cookie",
            "rezan_admin=" +
                token +
                "; HttpOnly; Path=/; SameSite=Lax"
        );

        res.json({
            success: true,
            message:
                "Giriş başarılı."
        });
    }
);

/* =========================================================
   ADMIN LOGOUT
========================================================= */

app.post(
    "/api/admin/logout",
    (req, res) => {
        const token =
            getSessionToken(req);

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
    }
);

/* =========================================================
   ADMIN SESSION
========================================================= */

app.get(
    "/api/admin/session",
    (req, res) => {
        const token =
            getSessionToken(req);

        res.json({
            loggedIn:
                !!(
                    token &&
                    sessions.has(
                        token
                    )
                )
        });
    }
);

/* =========================================================
   ŞİFRE DEĞİŞTİR
========================================================= */

app.post(
    "/api/admin/change-password",
    requireAdmin,
    (req, res) => {
        const oldPassword =
            cleanText(
                req.body.oldPassword
            );

        const newPassword =
            cleanText(
                req.body.newPassword
            );

        if (
            !oldPassword ||
            !newPassword
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Eski ve yeni şifre gereklidir."
                });
        }

        if (
            !verifyPassword(
                oldPassword,
                db.admin.passwordHash
            )
        ) {
            return res
                .status(401)
                .json({
                    success: false,
                    message:
                        "Eski şifre yanlış."
                });
        }

        if (
            newPassword.length < 6
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Yeni şifre en az 6 karakter olmalıdır."
                });
        }

        db.admin.passwordHash =
            hashPassword(
                newPassword
            );

        saveDB();

        res.json({
            success: true,
            message:
                "Şifre değiştirildi."
        });
    }
);

/* =========================================================
   KATEGORİLER
========================================================= */

app.get(
    "/api/categories",
    (req, res) => {
        res.json({
            success: true,
            categories:
                db.categories
        });
    }
);

app.post(
    "/api/categories",
    requireAdmin,
    (req, res) => {
        const name =
            cleanText(
                req.body.name
            );

        if (!name) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Kategori adı girin."
                });
        }

        if (name.length > 50) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Kategori adı en fazla 50 karakter olabilir."
                });
        }

        const exists =
            db.categories.some(
                category =>
                    normalizeTurkish(
                        category.name
                    ) ===
                    normalizeTurkish(
                        name
                    )
            );

        if (exists) {
            return res
                .status(409)
                .json({
                    success: false,
                    message:
                        "Bu kategori zaten var."
                });
        }

        const category = {
            id:
                createId("cat"),
            name
        };

        db.categories.push(
            category
        );

        saveDB();

        res.json({
            success: true,
            category
        });
    }
);

app.delete(
    "/api/categories/:id",
    requireAdmin,
    (req, res) => {
        const category =
            db.categories.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!category) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Kategori bulunamadı."
                });
        }

        const categoryName =
            normalizeTurkish(
                category.name
            );

        const usedProducts =
            db.products.filter(
                product => {
                    const categories =
                        normalizeCategories(
                            product
                        );

                    return categories.some(
                        item =>
                            normalizeTurkish(
                                item
                            ) ===
                            categoryName
                    );
                }
            );

        if (
            usedProducts.length > 0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Bu kategori " +
                        usedProducts.length +
                        " üründe kullanılıyor. Önce ürünlerin kategorisini değiştirin."
                });
        }

        db.categories =
            db.categories.filter(
                item =>
                    item.id !==
                    req.params.id
            );

        saveDB();

        res.json({
            success: true,
            message:
                "Kategori silindi."
        });
    }
);

/* =========================================================
   ÜRÜNLER
========================================================= */

app.get(
    "/api/products",
    (req, res) => {
        for (
            const product of
            db.products
        ) {
            normalizeProduct(
                product
            );
        }

        res.json({
            success: true,
            products:
                db.products
        });
    }
);

/* =========================================================
   ÜRÜN EKLE
========================================================= */

app.post(
    "/api/products",
    requireAdmin,
    (req, res) => {
        const body =
            req.body || {};

        const name =
            cleanText(
                body.name
            );

        const description =
            cleanText(
                body.description
            );

        const price =
            Number(body.price);

        const oldPrice =
            body.oldPrice === "" ||
            body.oldPrice === null ||
            body.oldPrice ===
                undefined
                ? 0
                : Number(
                      body.oldPrice
                  );

        const stock =
            body.stock === "" ||
            body.stock === null ||
            body.stock ===
                undefined
                ? 0
                : Number(
                      body.stock
                  );

        /*
          YENİ SİSTEM:
          categories: []

          ESKİ SİSTEM:
          category: "Kadın"
        */

        let categories =
            Array.isArray(
                body.categories
            )
                ? body.categories
                      .map(
                          item =>
                              cleanText(
                                  item
                              )
                      )
                      .filter(
                          Boolean
                      )
                : [];

        if (
            categories.length ===
                0 &&
            body.category
        ) {
            const oldCategory =
                cleanText(
                    body.category
                );

            if (oldCategory) {
                categories = [
                    oldCategory
                ];
            }
        }

        categories =
            [
                ...new Set(
                    categories
                )
            ];

        if (!name) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Ürün adı gereklidir."
                });
        }

        if (
            !Number.isFinite(
                price
            ) ||
            price < 0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Geçerli bir ürün fiyatı girin."
                });
        }

        const images =
            Array.isArray(
                body.images
            )
                ? body.images
                      .filter(Boolean)
                : [];

        let sizes = [];

        if (
            Array.isArray(
                body.sizes
            )
        ) {
            sizes =
                body.sizes
                    .map(
                        size => ({
                            name:
                                cleanText(
                                    size.name
                                ),

                            stock:
                                Math.max(
                                    0,
                                    Number(
                                        size.stock
                                    ) || 0
                                )
                        })
                    )
                    .filter(
                        size =>
                            size.name
                    );
        }

        const product = {
            id:
                createId(
                    "product"
                ),

            name,

            /*
              Eski frontend desteği
            */
            category:
                categories.length
                    ? categories[0]
                    : "",

            /*
              Yeni çoklu kategori
            */
            categories,

            price,

            oldPrice:
                Number.isFinite(
                    oldPrice
                ) &&
                oldPrice >= 0
                    ? oldPrice
                    : 0,

            stock:
                Number.isFinite(
                    stock
                ) &&
                stock >= 0
                    ? stock
                    : 0,

            sizes,

            images,

            description,

            reviews: [],

            createdAt:
                new Date().toISOString(),

            updatedAt:
                new Date().toISOString()
        };

        db.products.push(
            product
        );

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
        const product =
            db.products.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!product) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Ürün bulunamadı."
                });
        }

        const body =
            req.body || {};

        const name =
            cleanText(
                body.name
            );

        const description =
            cleanText(
                body.description
            );

        const price =
            Number(body.price);

        const oldPrice =
            body.oldPrice === "" ||
            body.oldPrice === null ||
            body.oldPrice ===
                undefined
                ? 0
                : Number(
                      body.oldPrice
                  );

        const stock =
            body.stock === "" ||
            body.stock === null ||
            body.stock ===
                undefined
                ? 0
                : Number(
                      body.stock
                  );

        let categories =
            Array.isArray(
                body.categories
            )
                ? body.categories
                      .map(
                          item =>
                              cleanText(
                                  item
                              )
                      )
                      .filter(
                          Boolean
                      )
                : [];

        if (
            categories.length ===
                0 &&
            body.category
        ) {
            const oldCategory =
                cleanText(
                    body.category
                );

            if (oldCategory) {
                categories = [
                    oldCategory
                ];
            }
        }

        categories =
            [
                ...new Set(
                    categories
                )
            ];

        /*
          Eğer yeni frontend
          kategori göndermediyse
          mevcut kategoriyi kaybetme.
        */
        if (
            categories.length ===
                0 &&
            Array.isArray(
                product.categories
            ) &&
            product.categories
                .length > 0
        ) {
            categories =
                product.categories;
        }

        if (
            categories.length ===
                0 &&
            product.category
        ) {
            categories = [
                product.category
            ];
        }

        if (!name) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Ürün adı gereklidir."
                });
        }

        if (
            !Number.isFinite(
                price
            ) ||
            price < 0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Geçerli bir fiyat girin."
                });
        }

        const images =
            Array.isArray(
                body.images
            )
                ? body.images.filter(
                      Boolean
                  )
                : Array.isArray(
                      product.images
                  )
                ? product.images
                : [];

        let sizes = [];

        if (
            Array.isArray(
                body.sizes
            )
        ) {
            sizes =
                body.sizes
                    .map(
                        size => ({
                            name:
                                cleanText(
                                    size.name
                                ),

                            stock:
                                Math.max(
                                    0,
                                    Number(
                                        size.stock
                                    ) || 0
                                )
                        })
                    )
                    .filter(
                        size =>
                            size.name
                    );
        } else {
            sizes =
                Array.isArray(
                    product.sizes
                )
                    ? product.sizes
                    : [];
        }

        product.name =
            name;

        product.categories =
            categories;

        product.category =
            categories.length
                ? categories[0]
                : "";

        product.description =
            description;

        product.price =
            price;

        product.oldPrice =
            Number.isFinite(
                oldPrice
            ) &&
            oldPrice >= 0
                ? oldPrice
                : 0;

        product.stock =
            Number.isFinite(
                stock
            ) &&
            stock >= 0
                ? stock
                : 0;

        product.sizes =
            sizes;

        product.images =
            images;

        if (
            !Array.isArray(
                product.reviews
            )
        ) {
            product.reviews = [];
        }

        product.updatedAt =
            new Date().toISOString();

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
        const index =
            db.products.findIndex(
                item =>
                    item.id ===
                    req.params.id
            );

        if (index === -1) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Ürün bulunamadı."
                });
        }

        db.products.splice(
            index,
            1
        );

        saveDB();

        res.json({
            success: true,
            message:
                "Ürün silindi."
        });
    }
);

/* =========================================================
   ÜRÜN YORUMLARI
========================================================= */

/*
  Herkes ürün hakkında
  yorum bırakabilir.
*/

app.post(
    "/api/products/:id/reviews",
    (req, res) => {
        const product =
            db.products.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!product) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Ürün bulunamadı."
                });
        }

        const body =
            req.body || {};

        const name =
            cleanText(
                body.name
            );

        const comment =
            cleanText(
                body.comment
            );

        const rating =
            Number(
                body.rating
            );

        if (!name) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Adınızı girin."
                });
        }

        if (
            name.length > 60
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "İsim en fazla 60 karakter olabilir."
                });
        }

        if (
            !comment
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Yorum yazın."
                });
        }

        if (
            comment.length >
            1000
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Yorum en fazla 1000 karakter olabilir."
                });
        }

        if (
            !Number.isFinite(
                rating
            ) ||
            rating < 1 ||
            rating > 5
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "1 ile 5 arasında yıldız seçin."
                });
        }

        if (
            !Array.isArray(
                product.reviews
            )
        ) {
            product.reviews = [];
        }

        const review = {
            id:
                createId(
                    "review"
                ),

            name,

            rating:
                Math.round(
                    rating
                ),

            comment,

            createdAt:
                new Date().toISOString()
        };

        product.reviews.unshift(
            review
        );

        product.updatedAt =
            new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            review
        });
    }
);

/* =========================================================
   YORUM SİL - ADMIN
========================================================= */

app.delete(
    "/api/products/:productId/reviews/:reviewId",
    requireAdmin,
    (req, res) => {
        const product =
            db.products.find(
                item =>
                    item.id ===
                    req.params.productId
            );

        if (!product) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Ürün bulunamadı."
                });
        }

        if (
            !Array.isArray(
                product.reviews
            )
        ) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Yorum bulunamadı."
                });
        }

        const index =
            product.reviews.findIndex(
                review =>
                    review.id ===
                    req.params.reviewId
            );

        if (index === -1) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Yorum bulunamadı."
                });
        }

        product.reviews.splice(
            index,
            1
        );

        product.updatedAt =
            new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            message:
                "Yorum silindi."
        });
    }
);

/* =========================================================
   GÖRSEL YÜKLE
========================================================= */

app.post(
    "/api/upload",
    requireAdmin,
    upload.array(
        "images",
        20
    ),
    (req, res) => {
        if (
            !req.files ||
            req.files.length === 0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Görsel seçilmedi."
                });
        }

        const files =
            req.files.map(
                file => ({
                    filename:
                        file.filename,

                    originalName:
                        file.originalname,

                    url:
                        "/uploads/" +
                        file.filename,

                    size:
                        file.size,

                    mimetype:
                        file.mimetype
                })
            );

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
        const filename =
            cleanText(
                req.body.filename
            );

        if (!filename) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Dosya adı belirtilmedi."
                });
        }

        const safeFilename =
            path.basename(
                filename
            );

        const filePath =
            path.join(
                UPLOAD_DIR,
                safeFilename
            );

        if (
            fs.existsSync(
                filePath
            )
        ) {
            try {
                fs.unlinkSync(
                    filePath
                );
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

const DEFAULT_PAYMENT_NOTE =
    "lütfen açıklamayı boş bırakın yoksa sipariş gerçekleştirilmez";

app.get(
    "/api/payment-info",
    (req, res) => {
        const paymentInfo = {
            bankName:
                cleanText(
                    db.paymentInfo.bankName
                ),

            accountName:
                cleanText(
                    db.paymentInfo.accountName
                ),

            iban:
                cleanText(
                    db.paymentInfo.iban
                ),

            description:
                cleanText(
                    db.paymentInfo.description
                ) ||
                DEFAULT_PAYMENT_NOTE
        };

        res.json({
            success: true,
            paymentInfo
        });
    }
);

app.put(
    "/api/payment-info",
    requireAdmin,
    (req, res) => {
        const body =
            req.body || {};

        db.paymentInfo = {
            bankName:
                cleanText(
                    body.bankName
                ),

            accountName:
                cleanText(
                    body.accountName
                ),

            iban:
                cleanText(
                    body.iban
                ),

            description:
                cleanText(
                    body.description
                )
        };

        saveDB();

        res.json({
            success: true,

            paymentInfo:
                {
                    ...db.paymentInfo,

                    description:
                        db.paymentInfo
                            .description ||
                        DEFAULT_PAYMENT_NOTE
                }
        });
    }
);

/* =========================================================
   ANA SAYFA / VİTRİN
========================================================= */

/*
  Müşterinin göreceği aktif
  vitrin slaytları.
*/

app.get(
    "/api/homepage",
    (req, res) => {
        const slides =
            db.homepage.slides
                .filter(
                    slide =>
                        slide.active !==
                        false
                )
                .sort(
                    (a, b) =>
                        Number(a.order) -
                        Number(b.order)
                );

        res.json({
            success: true,
            homepage: {
                slides
            }
        });
    }
);

/*
  Admin bütün vitrinleri görür.
*/

app.get(
    "/api/admin/homepage",
    requireAdmin,
    (req, res) => {
        res.json({
            success: true,
            homepage:
                db.homepage
        });
    }
);

/*
  Yeni vitrin ekle.
*/

app.post(
    "/api/homepage/slides",
    requireAdmin,
    (req, res) => {
        const body =
            req.body || {};

        const image =
            cleanText(
                body.image
            );

        const title =
            cleanText(
                body.title
            );

        const subtitle =
            cleanText(
                body.subtitle
            );

        const buttonText =
            cleanText(
                body.buttonText
            );

        const buttonLink =
            cleanText(
                body.buttonLink
            );

        if (!image) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Vitrin görseli gereklidir."
                });
        }

        const slide = {
            id:
                createId(
                    "slide"
                ),

            image,

            title,

            subtitle,

            buttonText,

            buttonLink,

            order:
                db.homepage.slides
                    .length,

            active:
                body.active !==
                false,

            createdAt:
                new Date().toISOString(),

            updatedAt:
                new Date().toISOString()
        };

        db.homepage.slides.push(
            slide
        );

        saveDB();

        res.json({
            success: true,
            slide
        });
    }
);

/*
  Vitrin güncelle.
*/

app.put(
    "/api/homepage/slides/:id",
    requireAdmin,
    (req, res) => {
        const slide =
            db.homepage.slides.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!slide) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Vitrin bulunamadı."
                });
        }

        const body =
            req.body || {};

        if (
            body.image !==
            undefined
        ) {
            const image =
                cleanText(
                    body.image
                );

            if (image) {
                slide.image =
                    image;
            }
        }

        if (
            body.title !==
            undefined
        ) {
            slide.title =
                cleanText(
                    body.title
                );
        }

        if (
            body.subtitle !==
            undefined
        ) {
            slide.subtitle =
                cleanText(
                    body.subtitle
                );
        }

        if (
            body.buttonText !==
            undefined
        ) {
            slide.buttonText =
                cleanText(
                    body.buttonText
                );
        }

        if (
            body.buttonLink !==
            undefined
        ) {
            slide.buttonLink =
                cleanText(
                    body.buttonLink
                );
        }

        if (
            body.active !==
            undefined
        ) {
            slide.active =
                Boolean(
                    body.active
                );
        }

        if (
            body.order !==
            undefined
        ) {
            const order =
                Number(
                    body.order
                );

            if (
                Number.isFinite(
                    order
                )
            ) {
                slide.order =
                    order;
            }
        }

        slide.updatedAt =
            new Date().toISOString();

        db.homepage.slides.sort(
            (a, b) =>
                Number(a.order) -
                Number(b.order)
        );

        saveDB();

        res.json({
            success: true,
            slide
        });
    }
);

/*
  Vitrin sil.
*/

app.delete(
    "/api/homepage/slides/:id",
    requireAdmin,
    (req, res) => {
        const index =
            db.homepage.slides.findIndex(
                slide =>
                    slide.id ===
                    req.params.id
            );

        if (index === -1) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Vitrin bulunamadı."
                });
        }

        const slide =
            db.homepage.slides[
                index
            ];

        /*
          Vitrin görselini de
          uploads klasöründen
          sil.
        */

        if (
            slide.image &&
            slide.image.startsWith(
                "/uploads/"
            )
        ) {
            const filename =
                path.basename(
                    slide.image
                );

            const filePath =
                path.join(
                    UPLOAD_DIR,
                    filename
                );

            if (
                fs.existsSync(
                    filePath
                )
            ) {
                try {
                    fs.unlinkSync(
                        filePath
                    );
                } catch {}
            }
        }

        db.homepage.slides.splice(
            index,
            1
        );

        /*
          Sıralamayı düzelt.
        */

        db.homepage.slides
            .sort(
                (a, b) =>
                    Number(a.order) -
                    Number(b.order)
            )
            .forEach(
                (slide, index) => {
                    slide.order =
                        index;
                }
            );

        saveDB();

        res.json({
            success: true,
            message:
                "Vitrin silindi."
        });
    }
);

/*
  Vitrin sıralama.
*/

app.put(
    "/api/homepage/slides/reorder",
    requireAdmin,
    (req, res) => {
        const ids =
            Array.isArray(
                req.body.ids
            )
                ? req.body.ids
                : [];

        if (
            ids.length === 0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Sıralama verisi gönderilmedi."
                });
        }

        ids.forEach(
            (id, index) => {
                const slide =
                    db.homepage.slides.find(
                        item =>
                            item.id ===
                            id
                    );

                if (slide) {
                    slide.order =
                        index;

                    slide.updatedAt =
                        new Date().toISOString();
                }
            }
        );

        db.homepage.slides.sort(
            (a, b) =>
                Number(a.order) -
                Number(b.order)
        );

        saveDB();

        res.json({
            success: true,
            slides:
                db.homepage.slides
        });
    }
);

/* =========================================================
   SİPARİŞ OLUŞTUR
========================================================= */

app.post(
    "/api/orders",
    (req, res) => {
        const body =
            req.body || {};

        const customer =
            body.customer || {};

        const incomingItems =
            Array.isArray(
                body.items
            )
                ? body.items
                : [];

        if (
            incomingItems.length ===
            0
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Sepet boş."
                });
        }

        const requiredCustomerFields =
            [
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

        for (
            const field of
            requiredCustomerFields
        ) {
            if (
                !cleanText(
                    customer[field]
                )
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Lütfen tüm teslimat bilgilerini doldurun."
                    });
            }
        }

        /*
          Sipariş notu opsiyoneldir.
        */

        const orderNote =
            cleanText(
                customer.note
            ).slice(0, 1000);

        const orderItems = [];
        let total = 0;

        /*
          Önce bütün ürünleri
          kontrol et.
        */

        for (
            const incoming of
            incomingItems
        ) {
            const productId =
                cleanText(
                    incoming.productId
                );

            const size =
                cleanText(
                    incoming.size
                );

            const quantity =
                Math.floor(
                    Number(
                        incoming.quantity
                    ) || 0
                );

            if (
                !productId ||
                quantity <= 0
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            "Sepette geçersiz ürün var."
                    });
            }

            const product =
                db.products.find(
                    item =>
                        item.id ===
                        productId
                );

            if (!product) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "Sepetteki ürün artık bulunamıyor."
                    });
            }

            let availableStock =
                Number(
                    product.stock
                ) || 0;

            let selectedSize =
                null;

            if (
                Array.isArray(
                    product.sizes
                ) &&
                product.sizes.length >
                    0
            ) {
                selectedSize =
                    product.sizes.find(
                        item =>
                            normalizeTurkish(
                                item.name
                            ) ===
                            normalizeTurkish(
                                size
                            )
                    );

                if (
                    !selectedSize
                ) {
                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                product.name +
                                " için beden/numara seçin."
                        });
                }

                availableStock =
                    Number(
                        selectedSize.stock
                    ) || 0;
            }

            if (
                availableStock <
                quantity
            ) {
                return res
                    .status(400)
                    .json({
                        success: false,
                        message:
                            product.name +
                            " için yeterli stok yok."
                    });
            }

            const itemTotal =
                Number(
                    product.price
                ) * quantity;

            total +=
                itemTotal;

            orderItems.push({
                productId:
                    product.id,

                name:
                    product.name,

                image:
                    Array.isArray(
                        product.images
                    ) &&
                    product.images.length >
                        0
                        ? product.images[0]
                        : "",

                size:
                    size || "",

                quantity,

                price:
                    Number(
                        product.price
                    ),

                total:
                    itemTotal
            });
        }

        /*
          Stok düş.
        */

        for (
            const item of
            orderItems
        ) {
            const product =
                db.products.find(
                    p =>
                        p.id ===
                        item.productId
                );

            if (!product) {
                continue;
            }

            if (
                Array.isArray(
                    product.sizes
                ) &&
                product.sizes.length >
                    0 &&
                item.size
            ) {
                const size =
                    product.sizes.find(
                        s =>
                            normalizeTurkish(
                                s.name
                            ) ===
                            normalizeTurkish(
                                item.size
                            )
                    );

                if (size) {
                    size.stock =
                        Math.max(
                            0,
                            Number(
                                size.stock
                            ) -
                            item.quantity
                        );
                }

                product.stock =
                    product.sizes.reduce(
                        (
                            sum,
                            s
                        ) =>
                            sum +
                            (
                                Number(
                                    s.stock
                                ) || 0
                            ),
                        0
                    );
            } else {
                product.stock =
                    Math.max(
                        0,
                        Number(
                            product.stock
                        ) -
                        item.quantity
                    );
            }
        }

        const order = {
            id:
                "RZ-" +
                new Date()
                    .toISOString()
                    .replace(
                        /\D/g,
                        ""
                    )
                    .slice(
                        0,
                        14
                    ) +
                "-" +
                crypto
                    .randomBytes(3)
                    .toString(
                        "hex"
                    )
                    .toUpperCase(),

            customer: {
                name:
                    cleanText(
                        customer.name
                    ),

                phone:
                    cleanText(
                        customer.phone
                    ),

                email:
                    cleanText(
                        customer.email
                    ),

                city:
                    cleanText(
                        customer.city
                    ),

                district:
                    cleanText(
                        customer.district
                    ),

                neighborhood:
                    cleanText(
                        customer.neighborhood
                    ),

                address:
                    cleanText(
                        customer.address
                    ),

                buildingNo:
                    cleanText(
                        customer.buildingNo
                    ),

                apartmentNo:
                    cleanText(
                        customer.apartmentNo
                    ),

                postalCode:
                    cleanText(
                        customer.postalCode
                    ),

                note:
                    orderNote
            },

            items:
                orderItems,

            total,

            paymentStatus:
                "pending",

            orderStatus:
                "Ödeme bekleniyor",

            shipping: {
                company: "",
                trackingNumber: ""
            },

            createdAt:
                new Date().toISOString(),

            updatedAt:
                new Date().toISOString()
        };

        db.orders.unshift(
            order
        );

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   SİPARİŞ GETİR
========================================================= */

app.get(
    "/api/orders/:id",
    (req, res) => {
        const order =
            db.orders.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!order) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Sipariş bulunamadı."
                });
        }

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   TÜM SİPARİŞLER
========================================================= */

app.get(
    "/api/orders",
    requireAdmin,
    (req, res) => {
        res.json({
            success: true,
            orders:
                db.orders
        });
    }
);

/* =========================================================
   ÖDEME ONAYLA
========================================================= */

app.post(
    "/api/orders/:id/confirm-payment",
    requireAdmin,
    (req, res) => {
        const order =
            db.orders.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!order) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Sipariş bulunamadı."
                });
        }

        order.paymentStatus =
            "paid";

        order.orderStatus =
            "Kargoya hazırlanıyor";

        order.updatedAt =
            new Date().toISOString();

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
        const order =
            db.orders.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!order) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Sipariş bulunamadı."
                });
        }

        order.paymentStatus =
            "not_received";

        order.orderStatus =
            "Ödeme alınmadı";

        order.updatedAt =
            new Date().toISOString();

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
        const order =
            db.orders.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!order) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Sipariş bulunamadı."
                });
        }

        if (
            order.orderStatus !==
            "İptal edildi"
        ) {
            for (
                const item of
                order.items || []
            ) {
                const product =
                    db.products.find(
                        p =>
                            p.id ===
                            item.productId
                    );

                if (!product) {
                    continue;
                }

                if (
                    Array.isArray(
                        product.sizes
                    ) &&
                    product.sizes.length >
                        0 &&
                    item.size
                ) {
                    const size =
                        product.sizes.find(
                            s =>
                                normalizeTurkish(
                                    s.name
                                ) ===
                                normalizeTurkish(
                                    item.size
                                )
                        );

                    if (size) {
                        size.stock =
                            (
                                Number(
                                    size.stock
                                ) || 0
                            ) +
                            (
                                Number(
                                    item.quantity
                                ) || 0
                            );
                    }

                    product.stock =
                        product.sizes.reduce(
                            (
                                sum,
                                s
                            ) =>
                                sum +
                                (
                                    Number(
                                        s.stock
                                    ) || 0
                                ),
                            0
                        );
                } else {
                    product.stock =
                        (
                            Number(
                                product.stock
                            ) || 0
                        ) +
                        (
                            Number(
                                item.quantity
                            ) || 0
                        );
                }
            }
        }

        order.paymentStatus =
            "cancelled";

        order.orderStatus =
            "İptal edildi";

        order.updatedAt =
            new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   KARGO EKLE
========================================================= */

app.post(
    "/api/orders/:id/shipping",
    requireAdmin,
    (req, res) => {
        const order =
            db.orders.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!order) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Sipariş bulunamadı."
                });
        }

        const company =
            cleanText(
                req.body.company
            );

        const trackingNumber =
            cleanText(
                req.body.trackingNumber
            );

        if (
            !company ||
            !trackingNumber
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Kargo firması ve takip numarası gereklidir."
                });
        }

        order.shipping = {
            company,
            trackingNumber
        };

        order.orderStatus =
            "Kargoya verildi";

        order.updatedAt =
            new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   KARGO SİL
========================================================= */

app.delete(
    "/api/orders/:id/shipping",
    requireAdmin,
    (req, res) => {
        const order =
            db.orders.find(
                item =>
                    item.id ===
                    req.params.id
            );

        if (!order) {
            return res
                .status(404)
                .json({
                    success: false,
                    message:
                        "Sipariş bulunamadı."
                });
        }

        order.shipping = {
            company: "",
            trackingNumber: ""
        };

        if (
            order.paymentStatus ===
            "paid"
        ) {
            order.orderStatus =
                "Kargoya hazırlanıyor";
        } else {
            order.orderStatus =
                "Ödeme bekleniyor";
        }

        order.updatedAt =
            new Date().toISOString();

        saveDB();

        res.json({
            success: true,
            order
        });
    }
);

/* =========================================================
   UPLOADS
========================================================= */

app.use(
    "/uploads",
    express.static(
        UPLOAD_DIR
    )
);

/* =========================================================
   ADMIN
========================================================= */

app.get(
    "/admin",
    (req, res) => {
        res.setHeader(
            "X-Robots-Tag",
            "noindex, nofollow, noarchive"
        );

        res.sendFile(
            path.join(
                ROOT_DIR,
                "admin.html"
            )
        );
    }
);

/* =========================================================
   ANA SAYFA
========================================================= */

app.get(
    "/",
    (req, res) => {
        res.sendFile(
            path.join(
                ROOT_DIR,
                "index.html"
            )
        );
    }
);

/* =========================================================
   STATİK
========================================================= */

app.use(
    express.static(
        ROOT_DIR,
        {
            index: false
        }
    )
);

/* =========================================================
   MULTER HATASI
========================================================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {
        if (
            error instanceof
            multer.MulterError
        ) {
            return res
                .status(400)
                .json({
                    success: false,
                    message:
                        "Görsel yükleme hatası: " +
                        error.message
                });
        }

        if (error) {
            console.error(
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        error.message ||
                        "Sunucu hatası."
                });
        }

        next();
    }
);

/* =========================================================
   SUNUCU
========================================================= */

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "REZAN GİYİM çalışıyor: http://localhost:" +
                PORT
        );

        console.log(
            "Admin paneli: http://localhost:" +
                PORT +
                "/admin"
        );
    }
);