require("dotenv").config();
const admin = require("firebase-admin");

const express = require("express");
const cors = require("cors");

// 🔑 Firebase Admin Init
console.log("THIS SERVER FILE IS RUNNING");

admin.initializeApp({
  credential: admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  )
});


const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Test API
app.get("/", (req, res) => {
  res.send("Backend is running");
});

// ✅ Create enrollment request
app.post("/enroll", async (req, res) => {
  try {
    const { uid,roll, course } = req.body;

    if (!uid ||  !roll || !course) {
      return res.status(400).json({ error: "Missing fields" });
    }

    await db.collection("enrollment_requests").add({
      studentUid: uid,
      roll,
      course,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ message: "Enrollment request submitted" });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//  Create Student Account (Admin only)
app.post("/create-student", async (req, res) => {
    console.log("CREATE-STUDENT ROUTE HIT");
  try {
    const { name, email } = req.body;

    if (!name  || !email) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // 1️⃣ Create Firebase Auth user (NO password)
    const userRecord = await admin.auth().createUser({
      email: email,
    });

    // 2️⃣ Save student details in Firestore
    await db.collection("users").doc(userRecord.uid).set({
      name: name,
      email: email,
      role: "student",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // 3️⃣ Generate password setup link
    const resetLink = await admin.auth()
      .generatePasswordResetLink(email);

    console.log("Student password setup link:", resetLink);

    res.json({
      message: "Student created successfully. Password setup link generated."
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ✅ Create Lecturer Account (Admin only)
app.post("/create-lecturer", async (req, res) => {
  try {
    //console.log("CREATE LECTURER BODY:", req.body);

    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const userRecord = await admin.auth().createUser({
      email: email,
    });

    await db.collection("users").doc(userRecord.uid).set({
      name,
      email,
      role: "lecturer",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const resetLink = await admin.auth()
      .generatePasswordResetLink(email);

    //console.log("PASSWORD RESET LINK:", resetLink);

    res.json({
      message: "Lecturer created successfully"
    });

  } catch (error) {
    console.error("CREATE LECTURER ERROR:", error);
    console.error("ERROR CODE:", error.code);
    console.error("ERROR MESSAGE:", error.message);

    res.status(500).json({
      error: error.message,
      code: error.code
    });
  }
});


app.get("/users", async (req, res) => {
  const snapshot = await db.collection("users").get();
  const users = [];

  snapshot.forEach(doc => {
    users.push({ uid: doc.id, ...doc.data() });
  });

  res.json(users);
});


app.delete("/delete-user/:uid", async (req, res) => {
  await admin.auth().deleteUser(req.params.uid);
  await db.collection("users").doc(req.params.uid).delete();
  res.json({ message: "User deleted successfully" });
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
