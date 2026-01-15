require("dotenv").config();
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("./cloudinary");

console.log("Cloudinary ENV CHECK", {
  cloud: process.env.CLOUDINARY_CLOUD_NAME,
  key: process.env.CLOUDINARY_API_KEY,
  secretLength: process.env.CLOUDINARY_API_SECRET?.length
});


/* =========================
   FIREBASE ADMIN INIT
========================= */
console.log("SERVER STARTING...");

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  )
});

const db = admin.firestore();
const app = express();


/* =========================
   MIDDLEWARE
========================= */





// ✅ CORS first
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// ❌ DO NOT use express.json() for FormData routes
// ❌ DO NOT use express.urlencoded() globally

// ✅ Multer setup
const upload = multer({ storage: multer.memoryStorage() });


/* =========================
   AUTH MIDDLEWARE (ADMIN)
========================= */
async function verifyAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = await admin.auth().verifyIdToken(token);

    const userDoc = await db.collection("users").doc(decoded.uid).get();
    if (!userDoc.exists || userDoc.data().role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    req.user = decoded;
    next();

  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* =========================
   TEST ROUTE
========================= */
app.get("/", (req, res) => {
  res.send("Backend is running");
});

/* =========================
   ENROLLMENT REQUEST
========================= */
app.post("/enroll", upload.array("photos", 2), async (req, res) => {
  try {
    // ✅ SAFELY READ FORM DATA
    const uid = req.body?.uid;
    const roll = req.body?.roll;
    const course = req.body?.course;

    if (!uid || !roll || !course) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: "At least 2 photos required" });
    }

    // ✅ UPLOAD IMAGES TO CLOUDINARY
    const imageUrls = [];

    for (const file of req.files) {
      const uploadResult = await cloudinary.uploader.upload(
        `data:${file.mimetype};base64,${file.buffer.toString("base64")}`,
        {
          folder: "student_enrollments",
        }
      );

      imageUrls.push(uploadResult.secure_url);
    }

    // ✅ SAVE ENROLLMENT REQUEST IN FIRESTORE
    await db.collection("enrollment_requests").add({
      studentUid: uid,
      roll,
      course,
      images: imageUrls,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ✅ SUCCESS RESPONSE
    res.json({ message: "Enrollment submitted successfully" });

  } catch (error) {
    console.error("ENROLL ERROR:", error);
    res.status(500).json({ error: "Enrollment failed" });
  }
})




/* =========================
   CREATE STUDENT (ADMIN)
========================= */
app.post("/create-student", verifyAdmin, async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email required" });
    }

    const user = await admin.auth().createUser({ email });

    await db.collection("users").doc(user.uid).set({
      name,
      email,
      role: "student",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await admin.auth().generatePasswordResetLink(email);

    res.json({ message: "Student created successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   CREATE LECTURER (ADMIN)
========================= */
app.post("/create-lecturer", verifyAdmin, async (req, res) => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const user = await admin.auth().createUser({ email });

    await db.collection("users").doc(user.uid).set({
      name,
      email,
      role: "lecturer",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await admin.auth().generatePasswordResetLink(email);

    res.json({ message: "Lecturer created successfully" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   GET USERS (ADMIN)
========================= */
app.get("/users", verifyAdmin, async (req, res) => {
  const snapshot = await db.collection("users").get();
  const users = [];
  snapshot.forEach(doc => {
    users.push({ uid: doc.id, ...doc.data() });
  });
  res.json(users);
});

/* =========================
   DELETE USER (ADMIN)
========================= */
app.delete("/delete-user/:uid", verifyAdmin, async (req, res) => {
  try {
    await admin.auth().deleteUser(req.params.uid);
    await db.collection("users").doc(req.params.uid).delete();
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});

app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR:", err);
  res.status(500).json({ error: "Internal Server Error" });
});
