require("dotenv").config();
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("./cloudinary");

// ✅ Node fetch (needed for Python service calls)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

console.log("FACE_SERVICE_URL AT RUNTIME:", process.env.FACE_SERVICE_URL);


async function callFaceService(url, payload) {
  try {
    console.log("CALLING FACE SERVICE:", url);
    console.log("PAYLOAD:", payload);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const text = await response.text();

    console.log("FACE SERVICE STATUS:", response.status);
    console.log("FACE SERVICE BODY:", text);

    if (!response.ok) {
      throw new Error(text);
    }

    return text;
  } catch (err) {
    console.error("FACE SERVICE CALL FAILED:", err);
    throw err;
  }
}



console.log("Cloudinary ENV CHECK", {
  cloud: process.env.CLOUDINARY_CLOUD_NAME,
  key: process.env.CLOUDINARY_API_KEY,
  secretLength: process.env.CLOUDINARY_API_SECRET?.length
});

/* =========================
   FIREBASE ADMIN INIT
========================= */
console.log("SERVER STARTING...");

const serviceAccount = JSON.parse(
  Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_B64,
    "base64"
  ).toString("utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



const db = admin.firestore();
const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// ✅ Multer setup
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   AUTH MIDDLEWARE (ADMIN)
========================= */
async function verifyAdmin(req, res, next) {
  try {
    const token = req.headers.authorization?.split("Bearer ")[1];
    if (!token) return res.status(401).json({ error: "No token provided" });

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
   ENROLLMENT REQUEST (STUDENT)
========================= */
app.post("/enroll", upload.array("photos", 3), async (req, res) => {
  try {
    console.log("ENROLL ROUTE HIT");
    console.log("BODY:", req.body);
    console.log("FILES:", req.files?.length);

    const { uid, roll, course } = req.body;

    if (!uid || !roll || !course) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: "At least 2 photos required" });
    }

    const uploadedPhotos = [];

    for (const file of req.files) {
      console.log("Uploading:", file.originalname);

      const base64Image = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

      const result = await cloudinary.uploader.upload(base64Image, {
        folder: "student_enrollments"
      });

      console.log("Uploaded URL:", result.secure_url);
      uploadedPhotos.push(result.secure_url);
    }

    await db.collection("enrollment_requests").add({
      studentUid: uid,
      roll,
      course,
      photos: uploadedPhotos,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      message: "Enrollment submitted successfully",
      photos: uploadedPhotos
    });

  } catch (err) {
    console.error("ENROLL ERROR FULL:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =========================
   APPROVE ENROLLMENT (ADMIN)
========================= */
app.post("/approve-enrollment/:id", verifyAdmin, async (req, res) => {
  console.log("🔥 APPROVAL → CALLING ENCODE FOR:", enrollment.studentUid);

  try {
    const ref = db.collection("enrollment_requests").doc(req.params.id);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: "Enrollment request not found" });
    }

    const enrollment = snap.data();

    // 🔥 TRY FACE ENCODING FIRST
    await callFaceService(
      `${process.env.FACE_SERVICE_URL}/encode-student`,
      {
        uid: enrollment.studentUid,
        photos: enrollment.photos,
        course: enrollment.course
      }
    );

    // ✅ ONLY AFTER SUCCESS
    await ref.update({
      status: "approved",
      encodingStatus: "success"
    });

    res.json({
      message: "Enrollment approved and face encoded successfully"
    });

  } catch (err) {
    console.error("APPROVAL ERROR:", err);

    // ❌ Encoding failed → do NOT approve
    await db.collection("enrollment_requests")
      .doc(req.params.id)
      .update({
        status: "encoding_failed"
      });

    res.status(500).json({
      error: "Face encoding failed. Enrollment not approved."
    });
  }
});


/* =========================
   CREATE STUDENT (ADMIN)
========================= */
app.post("/create-student", verifyAdmin, async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email)
      return res.status(400).json({ error: "Name and email required" });

    const user = await admin.auth().createUser({ email });

    await db.collection("users").doc(user.uid).set({
      name,
      email,
      role: "student",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const link = await admin.auth().generatePasswordResetLink(email);
    console.log("PASSWORD RESET LINK:", link);

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
    if (!name || !email)
      return res.status(400).json({ error: "Missing fields" });

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
  snapshot.forEach(doc => users.push({ uid: doc.id, ...doc.data() }));
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

app.post("/upload-class-photo", upload.single("photo"), async (req, res) => {
  try {
    const { lecturerUid, year, semester, course } = req.body;

    if (!lecturerUid || !year || !semester || !course) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Photo required" });
    }

    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // Upload class photo
    const result = await cloudinary.uploader.upload(base64Image, {
      folder: "class_photos"
    });

    // Create attendance session
    const sessionRef = await db.collection("attendance_sessions").add({
      lecturerUid,
      year,
      semester,
      course: course.toLowerCase(),
      classPhotoUrl: result.secure_url,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const sessionId = sessionRef.id; // 🔥 REQUIRED

    // Call Python service (non-blocking)
    callFaceService(
      `${process.env.FACE_SERVICE_URL}/mark-attendance`,
      {
        groupPhoto: result.secure_url,
        course: course.toLowerCase(),
        sessionId
      }
    ).catch(() => {});

    res.json({
      message: "Class photo uploaded successfully",
      sessionId
    });

  } catch (err) {
    console.error("UPLOAD CLASS PHOTO ERROR:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});


/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
