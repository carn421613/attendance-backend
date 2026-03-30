// ...existing code...
// Route moved after app initialization
require("dotenv").config();
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("./cloudinary");
const path = require("path");
const app=express()
const cors = require("cors");

app.use(cors({
  origin: "*",   // allow ALL origins
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());
app.use(express.static(path.join(__dirname, "../student")));
// ✅ Node fetch (needed for Python service calls)
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));


//GROQ AI

const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});
async function askAI(question) {

  try {

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an AI assistant for a university attendance system. Answer briefly and clearly."
        },
        {
          role: "user",
          content: question
        }
      ],
      model: "llama-3.1-8b-instant"
    });

    return completion.choices[0].message.content;

  } catch (error) {

    console.error("Groq error:", error.message);

    return "I'm here to help with attendance queries. Please ask about attendance, courses, or enrollment.";

  }

}


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

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  // Render
  serviceAccount = JSON.parse(
    Buffer.from(
      process.env.FIREBASE_SERVICE_ACCOUNT_B64,
      "base64"
    ).toString("utf8")
  );
} else {
  // Local
  serviceAccount = require("./serviceAccountKey.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();


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

    const { uid, roll, courseId } = req.body;

    if (!uid || !roll || !courseId)
      return res.status(400).json({ error: "Missing fields" });

    if (!req.files || req.files.length < 2)
      return res.status(400).json({ error: "At least 2 photos required" });

    /* FETCH STUDENT PROFILE */

    const studentSnap = await db.collection("users").doc(uid).get();

    if (!studentSnap.exists)
      return res.status(404).json({ error: "Student not found" });

    const student = studentSnap.data();

    const {
      branch,
      currentYear,
      currentSemester,
      academicYear
    } = student;

    /* VALIDATE COURSE */

    const courseDoc = await db.collection("courses").doc(courseId).get();

    if (!courseDoc.exists)
      return res.status(400).json({ error: "Invalid course selected" });

    const courseName = courseDoc.data().name;

    /* CREATE CLASS ID */

    const classId =
      `${courseId}_${branch}_${currentYear}_${currentSemester}_${academicYear}`;

    /* CHECK DUPLICATE ENROLLMENT */

    const existingEnrollment =
      await db.collection("student_courses")
        .doc(classId)
        .collection("students")
        .doc(uid)
        .get();

    if (existingEnrollment.exists)
      return res.status(400).json({
        error: `You are already enrolled in ${courseName}`
      });

    /* CHECK PENDING REQUEST */
    const existingRequest = await db
      .collection("enrollment_requests")
      .where("studentUid", "==", uid)
      .where("courseId", "==", courseId)
      .where("year", "==", currentYear)
      .where("semester", "==", currentSemester)
      .where("academicYear", "==", academicYear)
      .get();

    if (!existingRequest.empty) {

      let hasPending = false;
      let hasApproved = false;

      existingRequest.forEach(doc => {
        const data = doc.data();
        if (data.status === "pending") hasPending = true;
        if (data.status === "approved") hasApproved = true;
      });

      if (hasPending) {
        return res.status(400).json({
          error: `You already have a pending request for ${courseName}`
        });
      }

      if (hasApproved) {
        return res.status(400).json({
          error: `You are already enrolled in ${courseName}`
        });
      }
    }

    /* UPLOAD PHOTOS */

    const uploadedPhotos = [];

    for (const file of req.files) {

      const base64Image =
        `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

      const result =
        await cloudinary.uploader.upload(base64Image, {
          folder: "student_enrollments"
        });

      uploadedPhotos.push(result.secure_url);

    }

    /* CREATE ENROLLMENT REQUEST */

    await db.collection("enrollment_requests").add({

      studentUid: uid,
      roll,
      courseId,
      courseName,

      branch,
      year: currentYear,
      semester: currentSemester,
      academicYear,

      photos: uploadedPhotos,
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()

    });

    res.json({
      message: "Enrollment submitted successfully"
    });

  }

  catch (err) {

    console.error("ENROLL ERROR:", err);

    res.status(500).json({
      error: err.message
    });

  }

});


/* =========================
   APPROVE ENROLLMENT (ADMIN)
========================= */

/* =========================
   APPROVE ENROLLMENT (ADMIN)
========================= */

app.post("/approve-enrollment/:id", verifyAdmin, async (req, res) => {

  try {

    console.log("=== APPROVE ENROLLMENT START ===");

    const requestRef =
      db.collection("enrollment_requests").doc(req.params.id);

    const requestSnap = await requestRef.get();

    if (!requestSnap.exists)
      return res.status(404).json({ error: "Request not found" });

    const request = requestSnap.data();

    const {
      courseId,
      courseName,
      studentUid,
      roll,
      branch,
      year,
      semester,
      academicYear
    } = request;

    /* FETCH STUDENT */

    const studentSnap =
      await db.collection("users").doc(studentUid).get();

    if (!studentSnap.exists)
      return res.status(404).json({ error: "Student not found" });

    const student = studentSnap.data();

    const completedSubjects =
      (student.semesters || []).flatMap(s => s.subjects || []);

    /* COURSE RULES */

    const courseRules = {

      "advanced data structures": {
        prerequisite: "data structures",
        minCgpa: 7.5,
        strictCgpa: 8.5,
        seatLimit: 80
      },

      "advanced machine learning": {
        prerequisite: "machine learning",
        minCgpa: 7.5,
        strictCgpa: 8.5,
        seatLimit: 80
      }

    };

    const rule =
      courseRules[courseName.toLowerCase()] || {
        minCgpa: 7.0,
        strictCgpa: 8.0,
        seatLimit: 80
      };

    /* PREREQUISITE CHECK */

    if (rule.prerequisite &&
      !completedSubjects.includes(rule.prerequisite)) {

      await requestRef.update({ status: "rejected" });

      return res.json({
        message: "Rejected — prerequisite not completed"
      });
    }

    /* CGPA CHECK */

    if (Number(student.cgpa) < rule.minCgpa) {

      await requestRef.update({ status: "rejected" });

      return res.json({
        message: "Rejected — CGPA below requirement"
      });
    }

    /* CREATE CLASS ID */

    const classId =
      `${courseId}_${branch}_${year}_${semester}_${academicYear}`;

    const classRef =
      db.collection("student_courses").doc(classId);

    /* CHECK CURRENT SEATS */

    const classDoc = await classRef.get();

    const seatCount =
      classDoc.exists ? (classDoc.data().count || 0) : 0;

    console.log("Current seats:", seatCount);

    /* SEATS FULL */

    if (seatCount >= rule.seatLimit) {

      if (Number(student.cgpa) < rule.strictCgpa) {

        await requestRef.update({ status: "waitlisted" });

        return res.json({
          message: "Added to waitlist"
        });

      }

    }

    /* ENSURE CLASS DOC EXISTS */

    await classRef.set({

      courseId,
      course: courseName,
      branch,
      year,
      semester,
      academicYear,
      count: admin.firestore.FieldValue.increment(0)

    }, { merge: true });

    /* ADD STUDENT */

    await classRef
      .collection("students")
      .doc(studentUid)
      .set({

        studentUid,
        roll,
        enrolledAt:
          admin.firestore.FieldValue.serverTimestamp()

      });

    /* INCREMENT COUNT */

    await classRef.set({

      count: admin.firestore.FieldValue.increment(1)

    }, { merge: true });

    await requestRef.update({ status: "approved" });

    /* SAVE COURSE IN USER PROFILE */

    await db
      .collection("users")
      .doc(studentUid)
      .set(
        {
          enrolledCourses:
            admin.firestore.FieldValue.arrayUnion(courseName)
        },
        { merge: true }
      );

    res.json({
      message: "Enrollment approved successfully"
    });

  }

  catch (err) {

    console.error("ENROLLMENT ERROR:", err);

    res.status(500).json({
      error: "Enrollment failed"
    });

  }

});












/* =========================
   CREATE STUDENT (ADMIN)
========================= */

app.post("/create-student", verifyAdmin, async (req, res) => {

  try {

    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: "Name and email required"
      });
    }

    const cleanName = name.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();


    /* =========================
       CHECK FIRESTORE DUPLICATE
    ========================= */

    const existingUser = await db
      .collection("users")
      .where("email", "==", cleanEmail)
      .get();

    if (!existingUser.empty) {
      return res.status(400).json({
        error: "User already exists with this email"
      });
    }


    /* =========================
       CHECK NAME + EMAIL
    ========================= */

    const duplicateCombo = await db
      .collection("users")
      .where("name", "==", cleanName)
      .where("email", "==", cleanEmail)
      .get();

    if (!duplicateCombo.empty) {
      return res.status(400).json({
        error: "Duplicate user detected"
      });
    }


    /* =========================
       CREATE FIREBASE AUTH USER
    ========================= */

    const user = await admin.auth().createUser({
      email: cleanEmail
    });


    /* =========================
       STORE IN USERS COLLECTION
    ========================= */

    await db.collection("users").doc(user.uid).set({

      name: cleanName,
      email: cleanEmail,
      role: "student",

      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });


    const link =
      await admin.auth().generatePasswordResetLink(cleanEmail);

    console.log("PASSWORD RESET LINK:", link);


    res.json({
      message: "Student created successfully"
    });

  }

  catch (err) {

    console.error("CREATE STUDENT ERROR:", err);

    res.status(500).json({
      error: err.message
    });

  }

});


/* =========================
   CREATE LECTURER (ADMIN)
========================= */

app.post("/create-lecturer", verifyAdmin, async (req, res) => {

  try {

    const { name, email } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        error: "Missing fields"
      });
    }

    const cleanName = name.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();


    /* =========================
       CHECK FIRESTORE DUPLICATE
    ========================= */

    const existingUser = await db
      .collection("users")
      .where("email", "==", cleanEmail)
      .get();

    if (!existingUser.empty) {
      return res.status(400).json({
        error: "User already exists with this email"
      });
    }


    /* =========================
       CHECK NAME + EMAIL
    ========================= */

    const duplicateCombo = await db
      .collection("users")
      .where("name", "==", cleanName)
      .where("email", "==", cleanEmail)
      .get();

    if (!duplicateCombo.empty) {
      return res.status(400).json({
        error: "Duplicate user detected"
      });
    }


    /* =========================
       CREATE AUTH USER
    ========================= */

    const user = await admin.auth().createUser({
      email: cleanEmail
    });


    /* =========================
       STORE IN USERS COLLECTION
    ========================= */

    await db.collection("users").doc(user.uid).set({

      name: cleanName,
      email: cleanEmail,
      role: "lecturer",

      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });


    await admin.auth().generatePasswordResetLink(cleanEmail);


    res.json({
      message: "Lecturer created successfully"
    });

  }

  catch (err) {

    console.error("CREATE LECTURER ERROR:", err);

    res.status(500).json({
      error: err.message
    });

  }

});

/* ========================
   GET USERS (ADMIN)
========================= */
app.get("/users", verifyAdmin, async (req, res) => {
  const snapshot = await db.collection("users").get();
  const users = [];
  snapshot.forEach(doc => users.push({ uid: doc.id, ...doc.data() }));
  res.json(users);
});


/* =========================
   GET COURSES
========================= */

app.get("/courses", async (req, res) => {

  try {

    const snap = await db.collection("courses").get();

    const courses = [];

    snap.forEach(doc => {

      courses.push({
        id: doc.id,
        ...doc.data()
      });

    });

    res.json(courses);

  }

  catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

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


/*====================
  UPLOAD CLASS PHOTO
  ======================*/
app.post("/upload-class-photo", upload.single("photo"), async (req, res) => {

  try {

    const { lecturerUid, branch, academicYear, year, semester, course } = req.body;

    if (!lecturerUid || !branch || !academicYear || !year || !semester || !course) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Photo required" });
    }

    /* =========================
       FIND COURSE ID
    ========================= */

    const courseSnap = await db
      .collection("courses")
      .where("name", "==", course)
      .get();

    if (courseSnap.empty) {
      return res.status(400).json({ error: "Course not found" });
    }

    const courseDoc = courseSnap.docs[0];
    const courseId = courseDoc.id;
    const courseName = courseDoc.data().name;

    /* =========================
       VERIFY LECTURER ASSIGNMENT
    ========================= */

    const assignSnap = await db
      .collection("lecturer_assignments")
      .where("lecturerUid", "==", lecturerUid)
      .where("courseId", "==", courseId)
      .where("branch", "==", branch)
      .where("year", "==", year)
      .where("semester", "==", semester)
      .where("academicYear", "==", academicYear)
      .get();

    if (assignSnap.empty) {
      return res.status(400).json({
        error: "Lecturer not assigned to this class"
      });
    }

    /* =========================
       CREATE CLASS ID
    ========================= */

    const classId =
      `${courseId}_${branch}_${year}_${semester}_${academicYear}`;

    /* =========================
       UPLOAD PHOTO
    ========================= */

    const base64Image =
      `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    const result = await cloudinary.uploader.upload(base64Image, {
      folder: "class_photos"
    });

    /* =========================
       CREATE ATTENDANCE SESSION
    ========================= */

    const sessionRef = await db.collection("attendance_sessions").add({

      lecturerUid,

      courseId,
      course: courseName,

      branch,
      year,
      semester,
      academicYear,

      classId,

      classPhotoUrl: result.secure_url,

      createdAt: admin.firestore.FieldValue.serverTimestamp()

    });

    const sessionId = sessionRef.id;

    /* =========================
       CALL FACE SERVICE
    ========================= */

    callFaceService(
      `${process.env.FACE_SERVICE_URL}/mark-attendance`,
      {
        groupPhoto: result.secure_url,
        classId: classId,
        sessionId: sessionId,

        courseId,
        course: courseName,
        lecturerUid,
        year,
        semester
      }
    ).catch(() => { });

    res.json({
      message: "Class photo uploaded successfully",
      sessionId
    });

  }

  catch (err) {

    console.error("UPLOAD CLASS PHOTO ERROR:", err);

    res.status(500).json({
      error: "Upload failed"
    });

  }

});
/* =======================
   CREATE COURSE
======================= */

app.post("/create-course", verifyAdmin, async (req, res) => {

  try {

    const { name, courseId } = req.body;

    if (!name || !courseId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const courseRef =
      db.collection("courses").doc(courseId.toUpperCase());

    const existing = await courseRef.get();

    if (existing.exists) {
      return res.status(400).json({
        error: "Course ID already exists"
      });
    }

    await courseRef.set({
      id: courseId.toUpperCase(),
      name,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      message: "Course registered successfully"
    });

  }

  catch (err) {

    console.error(err);

    res.status(500).json({
      error: err.message
    });

  }

});

/* =======================
   ASSIGN LECTURER COURSE
======================= */

app.post("/assign-lecturer-course", verifyAdmin, async (req, res) => {

  try {

    const { lecturerUid, courseId, branch, year, semester, academicYear } = req.body;

    if (!lecturerUid || !courseId || !branch || !year || !semester || !academicYear) {
      return res.status(400).json({
        error: "Missing fields"
      });
    }

    const courseSnap = await db.collection("courses").doc(courseId).get();

    if (!courseSnap.exists) {
      return res.status(404).json({ error: "Course not found" });
    }

    const courseName = courseSnap.data().name;

    const lecturerSnap = await db.collection("users").doc(lecturerUid).get();

    if (!lecturerSnap.exists) {
      return res.status(404).json({ error: "Lecturer not found" });
    }

    const lecturerName = lecturerSnap.data().name;

    /* CHECK DUPLICATE ASSIGNMENT */

    const existing = await db
      .collection("lecturer_assignments")
      .where("lecturerUid", "==", lecturerUid)
      .where("courseId", "==", courseId)
      .where("branch", "==", branch)
      .where("year", "==", year)
      .where("semester", "==", semester)
      .where("academicYear", "==", academicYear)
      .get();

    if (!existing.empty) {
      return res.status(400).json({
        error: "Lecturer already assigned to this class"
      });
    }

    await db.collection("lecturer_assignments").add({

      lecturerUid,
      lecturerName,
      courseId,
      courseName,
      branch,
      year,
      semester,
      academicYear,

      createdAt:
        admin.firestore.FieldValue.serverTimestamp()

    });

    res.json({
      message: "Course assigned successfully"
    });

  }

  catch (err) {

    console.error("ASSIGN COURSE ERROR:", err);

    res.status(500).json({
      error: err.message
    });

  }

});

/*------------------------------
PROFILE MANAGING
--------------------------------*/
/* ======================
   SAVE STUDENT PROFILE
====================== */
/* ======================
   SAVE STUDENT PROFILE
====================== */

app.post("/student/profile", async (req, res) => {

  try {

    const {
      uid,
      branch,
      academicYear,
      currentYear,
      currentSemester,
      semesters,
      cgpa
    } = req.body;

    if (!uid) {
      return res.status(400).json({
        error: "UID required"
      });
    }

    await db.collection("users").doc(uid).set({

      branch,
      academicYear,

      currentYear,
      currentSemester,

      semesters,
      cgpa,

      updatedAt:
        admin.firestore.FieldValue.serverTimestamp()

    }, { merge: true });

    res.json({
      message: "Student academic profile saved successfully"
    });

  }

  catch (err) {

    console.error("PROFILE SAVE ERROR:", err);

    res.status(500).json({
      error: err.message
    });

  }

});
/* ======================
   GET STUDENT PROFILE
====================== */
app.get("/student/profile/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    const doc = await db.collection("users").doc(uid).get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Profile not found" });
    }

    res.json(doc.data());

  } catch (err) {
    console.error("PROFILE FETCH ERROR:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});



/* =========================
   HELPER: GET ATTENDANCE FROM SESSIONS
========================= */
async function getAttendanceFromSessions(uid) {

  console.log("Checking attendance for UID:", uid);

  const sessionsSnap = await db.collection("attendance_sessions").get();

  let totalClasses = 0;
  let attended = 0;

  for (const sessionDoc of sessionsSnap.docs) {

    console.log("Checking session:", sessionDoc.id);

    const recordDoc = await db
      .collection("attendance_sessions")
      .doc(sessionDoc.id)
      .collection("records")
      .doc(uid)
      .get();

    console.log("Record exists:", recordDoc.exists);

    if (recordDoc.exists) {

      totalClasses++;

      const data = recordDoc.data();
      console.log("Record data:", data);

      if (data.status === "present") {
        attended++;
      }

    }

  }

  console.log("Total:", totalClasses, "Attended:", attended);

  return { totalClasses, attended };

}
/* =========================
   COURSE ALIASES
========================= */

const courseAliases = {

  "ai": "artificial intelligence",
  "artificialintelligence": "artificial intelligence",
  "artificial intelligence": "artificial intelligence",

  "ml": "machine learning",
  "machinelearning": "machine learning",
  "machine learning": "machine learning",

  "dl": "deep learning",
  "deeplearning": "deep learning",
  "deep learning": "deep learning",

  "ds": "data structures",
  "datastructures": "data structures",
  "data structures": "data structures"

};
/* =========================
   FIND COURSE ID FROM USER INPUT
========================= */

async function getCourseIdFromAlias(input) {

  if (!input) return null;

  let text = input.toLowerCase().trim();
  const noSpace = text.replace(/\s+/g, "");

  const fullName =
    courseAliases[noSpace] ||
    courseAliases[text] ||
    text;

  const snap = await db.collection("courses").get();

  for (const doc of snap.docs) {

    const data = doc.data();

    const courseName =
      (data.name || "")
        .toLowerCase()
        .replace(/\s+/g, "");

    if (courseName === fullName.replace(/\s+/g, "")) {
      return {
        id: doc.id,
        name: data.name
      };
    }

  }

  return null;

}


/* =========================
   HELPER: SEND RESPONSE
========================= */


function sendReplies(res, messages) {

  let text = "";

  if (Array.isArray(messages)) {
    text = messages.join("\n");
  } else {
    text = messages;
  }

  return res.json({
    fulfillmentText: text
  });

}

/* =========================
   ROLE CHECKERS
========================= */

function requireStudent(res, role) {

  if (!role || role.toLowerCase() !== "student") {

    sendReply(res, "Only students can access this feature.");
    return false;

  }

  return true;

}

function requireLecturer(res, role) {

  if (!role || role.toLowerCase() !== "lecturer") {

    sendReply(res, "Only lecturers can access this feature.");
    return false;

  }

  return true;

}
function sendReply(res, messages) {

  // If single message, convert to array
  if (!Array.isArray(messages)) {
    messages = [messages];
  }

  const fulfillmentMessages = messages.map(m => ({
    text: {
      text: [m]
    }
  }));

  return res.json({
    fulfillmentMessages
  });

}

/* =========================
   CHATBOT WEBHOOK
========================= */


app.post("/chatbot", async (req, res) => {

  try {

    const intent = req.body.queryResult.intent.displayName;
    console.log("CHATBOT INTENT:", intent);

    let uid = null;

    try {
      const session = req.body.session;
      if (session) uid = session.split("/").pop();
    } catch { }

    console.log("UID RECEIVED:", uid);

    /* FETCH USER ROLE */

    let role = "student";

    try {
      const userDoc = await db.collection("users").doc(uid).get();
      if (userDoc.exists) role = userDoc.data().role || "student";
    } catch { }

    console.log("USER ROLE:", role);

    /* GREETING */

    if (intent === "Greeting") {
      return sendReplies(res, [
        "Hello!",
        "I am your Attendance Assistant.",
        "Ask me about attendance, courses, or enrollment."
      ]);
    }


    /* ATTENDANCE SUMMARY */

    if (intent === "Attendance_summary") {

      if (!requireStudent(res, role)) return;

      const snap = await db
        .collection("attendance_summary")
        .doc(uid)
        .collection("courses")
        .get();

      if (snap.empty)
        return sendReplies(res, ["No attendance records found yet."]);

      let total = 0;
      let attended = 0;

      const messages = ["📊 Attendance Report"];

      for (const doc of snap.docs) {

        const courseId = doc.id;
        const data = doc.data();

        const courseInfo = await db
          .collection("courses")
          .doc(courseId)
          .get();

        const courseName = courseInfo.data()?.name || courseId;

        const t = data.totalClasses || 0;
        const a = data.attended || 0;
        const m = t - a;

        const percent = t === 0 ? 0 : ((a / t) * 100).toFixed(1);

        total += t;
        attended += a;

        messages.push(`📘 ${courseName}`);
        messages.push(`Total Classes : ${t}`);
        messages.push(`Attended : ${a}`);
        messages.push(`Missed : ${m}`);
        messages.push(`Attendance : ${percent}%`);
      }

      const overall = total === 0 ? 0 : ((attended / total) * 100).toFixed(1);

      messages.push(`Overall Attendance : ${overall}%`);

      if (overall < 75)
        messages.push("⚠️ Your attendance is below 75%");
      else
        messages.push("✅ Your attendance is safe");

      return sendReplies(res, messages);
    }


    /* COURSE ATTENDANCE */

    if (intent === "Attendance_course") {

  if (!requireStudent(res, role)) return;

  const parameters = req.body.queryResult.parameters || {};
  const courseInput = parameters.course || "";

  const course = await getCourseIdFromAlias(courseInput);

  if (!course)
    return sendReplies(res, ["I couldn't recognize that course."]);

  const courseId = course.id;
  const courseName = course.name;

  // 🔥 STEP 1: Find student's class
  const classesSnap = await db.collection("student_courses").get();

  let classIdFound = null;

  for (const doc of classesSnap.docs) {
    const classId = doc.id;

    // match courseId (AI132)
    if (!classId.startsWith(courseId)) continue;

    // check if student exists inside
    const studentDoc = await db
      .collection("student_courses")
      .doc(classId)
      .collection("students")
      .doc(uid)
      .get();

    if (studentDoc.exists) {
      classIdFound = classId;
      break;
    }
  }

  if (!classIdFound)
    return sendReplies(res, [`You are not enrolled in ${courseName}`]);

  // 🔥 STEP 2: Get attendance
  const doc = await db
    .collection("attendance_summary")
    .doc(uid)
    .collection("courses")
    .doc(classIdFound)
    .get();

  if (!doc.exists)
    return sendReplies(res, ["No attendance records found yet."]);

  const data = doc.data();

  const total = data.totalClasses || 0;
  const attended = data.attended || 0;
  const missed = total - attended;

  const percent =
    total === 0 ? 0 : ((attended / total) * 100).toFixed(1);

  return sendReplies(res, [
    `📘 ${courseName}`,
    `Total Classes : ${total}`,
    `Attended : ${attended}`,
    `Missed : ${missed}`,
    `Attendance : ${percent}%`
  ]);
}

    /* ATTENDANCE WARNING */

    if (intent === "Attendance_Warning") {

      if (!requireStudent(res, role)) return;

      const snap = await db
        .collection("attendance_summary")
        .doc(uid)
        .collection("courses")
        .get();

      let total = 0;
      let attended = 0;

      snap.forEach(doc => {
        const d = doc.data();
        total += d.totalClasses || 0;
        attended += d.attended || 0;
      });

      if (total === 0)
        return sendReplies(res, ["No attendance records yet."]);

      const percent = ((attended / total) * 100).toFixed(1);

      if (percent < 75)
        return sendReplies(res, [
          "⚠️ Attendance Warning",
          `Current Attendance : ${percent}%`,
          "You are below the required 75%.",
          "Attend upcoming classes."
        ]);

      return sendReplies(res, [
        "✅ Attendance Safe",
        `Current Attendance : ${percent}%`
      ]);
    }


    /* MISSED CLASSES */

    if (intent === "missed_classes") {

      if (!requireStudent(res, role)) return;

      const snap = await db
        .collection("attendance_summary")
        .doc(uid)
        .collection("courses")
        .get();

      const messages = ["📊 Missed Classes"];

      let totalMissed = 0;

      for (const doc of snap.docs) {

        const data = doc.data();
        const courseId = doc.id;

        const courseInfo =
          await db.collection("courses").doc(courseId).get();

        const name = courseInfo.data()?.name || courseId;

        const missed =
          (data.totalClasses || 0) - (data.attended || 0);

        totalMissed += missed;

        messages.push(`${name} → ${missed} classes missed`);
      }

      messages.push(`Total Missed Classes : ${totalMissed}`);

      return sendReplies(res, messages);
    }


    /* COURSES ENROLLED */

    if (intent === "Courses_Enrolled") {

      if (!requireStudent(res, role)) return;

      const userDoc = await db.collection("users").doc(uid).get();
      const data = userDoc.data();

      if (!data.enrolledCourses || data.enrolledCourses.length === 0)
        return sendReplies(res, ["You are not enrolled in any courses."]);

      const messages = ["📚 Your Enrolled Courses"];

      data.enrolledCourses.forEach(course => {
        messages.push(`• ${course}`);
      });

      return sendReplies(res, messages);
    }


    /* REMAINING BUNK */

    if (intent === "Remaining_Bunk") {

      if (!requireStudent(res, role)) return;

      const snap = await db
        .collection("attendance_summary")
        .doc(uid)
        .collection("courses")
        .get();

      let total = 0;
      let attended = 0;

      snap.forEach(doc => {
        const d = doc.data();
        total += d.totalClasses || 0;
        attended += d.attended || 0;
      });

      const minAttendance = 0.75;
      const remaining = Math.floor((attended / minAttendance) - total);

      if (remaining <= 0)
        return sendReplies(res, [
          "⚠️ Attendance Limit Reached",
          "You cannot miss any more classes."
        ]);

      return sendReplies(res, [
        "📌 Remaining Bunks",
        `You can miss ${remaining} more class(es).`
      ]);
    }


    /* ENROLLMENT STATUS */

    if (intent === "Enrollment_Status") {

      if (!requireStudent(res, role)) return;

      const snap = await db
        .collection("enrollment_requests")
        .where("studentUid", "==", uid)
        .get();

      if (snap.empty)
        return sendReplies(res, [
          "You have not submitted any enrollment requests."
        ]);

      const messages = ["📄 Enrollment Status"];

      const promises = snap.docs.map(async doc => {

        const data = doc.data();

        const courseDoc = await db
          .collection("courses")
          .doc(data.courseId)
          .get();

        const name =
          courseDoc.exists
            ? courseDoc.data().name
            : data.courseId;

        return `${name} → ${data.status}`;
      });

      const results = await Promise.all(promises);

      results.forEach(r => messages.push(r));

      return sendReplies(res, messages);
    }

    /* =========================
    LOWEST / HIGHEST ATTENDANCE
 ========================= */

    if (intent === "lowest_highest_attendance") {

      console.log("lowest_highest_attendance intent triggered");

      if (!requireStudent(res, role)) return;

      try {

        const userQuery = req.body.queryResult.queryText.toLowerCase();

        const coursesSnap = await db
          .collection("attendance_summary")
          .doc(uid)
          .collection("courses")
          .get();

        if (coursesSnap.empty)
          return sendReplies(res, ["No attendance records found yet."]);

        let lowestCourse = null;
        let highestCourse = null;

        let lowestPercent = 100;
        let highestPercent = 0;

        for (const doc of coursesSnap.docs) {

          const courseId = doc.id;
          const data = doc.data();

          const total = data.totalClasses || 0;
          const attended = data.attended || 0;

          if (total === 0) continue;

          const percent = (attended / total) * 100;

          const courseInfo =
            await db.collection("courses").doc(courseId).get();

          const courseName =
            courseInfo.data()?.name || courseId;

          if (percent < lowestPercent) {
            lowestPercent = percent;
            lowestCourse = courseName;
          }

          if (percent > highestPercent) {
            highestPercent = percent;
            highestCourse = courseName;
          }

        }

        if (userQuery.includes("lowest")) {

          return sendReplies(res, [
            "📉 Lowest Attendance",
            `Course : ${lowestCourse}`,
            `Attendance : ${lowestPercent.toFixed(1)}%`
          ]);

        }

        if (userQuery.includes("highest")) {

          return sendReplies(res, [
            "📈 Highest Attendance",
            `Course : ${highestCourse}`,
            `Attendance : ${highestPercent.toFixed(1)}%`
          ]);

        }

        return sendReplies(res, [
          "📊 Attendance Analysis",
          `Lowest Attendance : ${lowestCourse} (${lowestPercent.toFixed(1)}%)`,
          `Highest Attendance : ${highestCourse} (${highestPercent.toFixed(1)}%)`
        ]);

      }

      catch (error) {

        console.error("Attendance analysis error:", error);

        return sendReplies(res, [
          "Sorry, I couldn't analyze your attendance."
        ]);

      }

    }


    /* =========================
       ATTENDANCE PREDICTION
    ========================= */

    if (intent === "Attendance_Prediction") {

      console.log("Attendance_Prediction intent triggered");

      if (!requireStudent(res, role)) return;

      try {

        const parameters = req.body.queryResult.parameters || {};
        const futureMissed = parameters.number || 0;

        const coursesSnap = await db
          .collection("attendance_summary")
          .doc(uid)
          .collection("courses")
          .get();

        if (coursesSnap.empty)
          return sendReplies(res, ["No attendance records found yet."]);

        let totalClasses = 0;
        let attended = 0;

        coursesSnap.forEach(doc => {

          const data = doc.data();

          totalClasses += data.totalClasses || 0;
          attended += data.attended || 0;

        });

        if (totalClasses === 0)
          return sendReplies(res, ["No classes recorded yet."]);

        const newTotal = totalClasses + futureMissed;

        const newPercent =
          ((attended / newTotal) * 100).toFixed(1);

        const currentPercent =
          ((attended / totalClasses) * 100).toFixed(1);

        const messages = [
          "📊 Attendance Prediction",
          `Current Attendance : ${currentPercent}%`,
          `If you miss ${futureMissed} upcoming classes`,
          `New Attendance : ${newPercent}%`
        ];

        if (newPercent < 75)
          messages.push("⚠️ This will drop your attendance below 75%");
        else
          messages.push("✅ Your attendance will remain above 75%");

        return sendReplies(res, messages);

      }

      catch (error) {

        console.error("Attendance prediction error:", error);

        return sendReplies(res, [
          "Sorry, I couldn't calculate the prediction."
        ]);

      }

    }
    /* =========================
       SMART ATTENDANCE ADVISOR
    ========================= */

    if (intent === "Smart_Attendance_Advisor") {

      console.log("Smart_Attendance_Advisor intent triggered");

      if (!requireStudent(res, role)) return;

      try {

        const coursesSnap = await db
          .collection("attendance_summary")
          .doc(uid)
          .collection("courses")
          .get();

        if (coursesSnap.empty)
          return sendReplies(res, ["No attendance records found yet."]);

        let totalClasses = 0;
        let attended = 0;

        coursesSnap.forEach(doc => {

          const data = doc.data();

          totalClasses += data.totalClasses || 0;
          attended += data.attended || 0;

        });

        if (totalClasses === 0)
          return sendReplies(res, ["No classes recorded yet."]);

        const percent =
          ((attended / totalClasses) * 100).toFixed(1);

        const requiredAttendance = 0.75;

        if (percent < 75) {

          const classesNeeded =
            Math.ceil(
              (requiredAttendance * totalClasses - attended) /
              (1 - requiredAttendance)
            );

          return sendReplies(res, [
            "⚠️ Attendance Alert",
            `Current Attendance : ${percent}%`,
            `Attend the next ${classesNeeded} classes continuously`,
            "to reach the required 75% attendance."
          ]);

        }

        const remaining =
          Math.floor((attended / requiredAttendance) - totalClasses);

        return sendReplies(res, [
          "✅ Attendance Safe",
          `Current Attendance : ${percent}%`,
          `You can miss ${remaining} more class(es)`
        ]);

      }

      catch (error) {

        console.error("Smart advisor error:", error);

        return sendReplies(res, [
          "Sorry, I couldn't generate attendance advice."
        ]);

      }

    }
    /* AI FALLBACK */

    if (intent === "Default Fallback Intent") {

      const userMessage = req.body.queryResult.queryText;
      const aiReply = await askAI(userMessage);

      return sendReplies(res, [aiReply]);
    }




    /* =========================
    LECTURER COURSES
 ========================= */

    if (intent === "Lecturer_Courses") {

      console.log("Lecturer_Courses intent triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const snap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        if (snap.empty) {
          return sendReplies(res, [
            "📚 Lecturer Courses",
            "",
            "You are not assigned to any courses."
          ]);
        }

        const messages = [
          "📚 Your Assigned Courses",
          ""
        ];

        for (const doc of snap.docs) {

          const data = doc.data();

          const courseInfo = await db
            .collection("courses")
            .doc(data.courseId)
            .get();

          const courseName =
            courseInfo.data()?.name || data.courseId;

          messages.push(`📘 ${courseName}`);
          messages.push(`Branch : ${data.branch}`);
          messages.push(`Year : ${data.year}`);
          messages.push(`Semester : ${data.semester}`);
          messages.push("");
        }

        return sendReplies(res, messages);

      }

      catch (error) {

        console.error("Lecturer_Courses error:", error);

        return sendReplies(res, [
          "Sorry, I couldn't retrieve your assigned courses."
        ]);

      }

    }


    /* =========================
       TOTAL CLASS STRENGTH
    ========================= */

    /* =========================
       TOTAL CLASS STRENGTH
    ========================= */


    if (intent === "Total_Enrolled_Students") {

      console.log("Lecturer_Total_Strength intent triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        if (assignSnap.empty) {

          return sendReply(res, [
            "📊 Total Class Strength",
            "You are not assigned to any classes."
          ]);

        }

        let totalStudents = 0;
        const messages = ["📊 Total Class Strength"];

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const {
            courseId,
            courseName,
            branch,
            year,
            semester,
            academicYear
          } = data;

          const classId =
            `${courseId}_${branch}_${year}_${semester}_${academicYear}`;

          const studentsSnap = await db
            .collection("student_courses")
            .doc(classId)
            .collection("students")
            .get();

          const count = studentsSnap.size;

          totalStudents += count;

          messages.push(`📘 ${courseName}`);
          messages.push(`Branch : ${branch}`);
          messages.push(`Year : ${year}`);
          messages.push(`Semester : ${semester}`);
          messages.push(`Students : ${count}`);


        }

        messages.push(`Total Students Across All Classes : ${totalStudents}`);

        return sendReply(res, messages);

      }

      catch (error) {

        console.error("Total strength error:", error);

        return sendReply(res, [
          "Sorry, I couldn't calculate the total strength."
        ]);

      }

    }

    /* =========================
       PARTICULAR COURSE STRENGTH
    ========================= */

    if (intent === "Lecturer_Course_Strength") {

      console.log("Lecturer_Course_Strength intent triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const parameters = req.body.queryResult.parameters || {};
        const courseInput = parameters.course || "";

        const course = await getCourseIdFromAlias(courseInput);

        if (!course) {

          return sendReply(res, [
            "I couldn't recognize that course."
          ]);

        }

        const courseId = course.id;
        const courseName = course.name;

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .where("courseId", "==", courseId)
          .get();

        if (assignSnap.empty) {

          return sendReply(res, [
            `You are not assigned to ${courseName}.`
          ]);

        }

        let total = 0;

        const messages = [
          `📊 ${courseName} Class Strength`
        ];

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const {
            branch,
            year,
            semester,
            academicYear
          } = data;

          const classId =
            `${courseId}_${branch}_${year}_${semester}_${academicYear}`;

          const studentsSnap = await db
            .collection("student_courses")
            .doc(classId)
            .collection("students")
            .get();

          const count = studentsSnap.size;

          total += count;

          messages.push(`Branch : ${branch}`);
          messages.push(`Year : ${year}`);
          messages.push(`Semester : ${semester}`);
          messages.push(`Students : ${count}`);
          messages.push("-------------------");

        }

        messages.push(`Total Students in ${courseName} : ${total}`);

        return sendReply(res, messages);

      }

      catch (error) {

        console.error("Course strength error:", error);

        return sendReply(res, [
          "Sorry, I couldn't retrieve the course strength."
        ]);

      }

    }


    /* =========================
       LOW ATTENDANCE STUDENTS
    ========================= */

    if (intent === "Lecturer_Low_Attendance") {

      console.log("Lecturer_Low_Attendance triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        const messages = ["⚠️ Students Below 75%"];

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const classId =
            `${data.courseId}_${data.branch}_${data.year}_${data.semester}_${data.academicYear}`;

          const analytics = await db
            .collection("class_analytics")
            .doc(classId)
            .get();

          if (!analytics.exists) continue;

          const students =
            analytics.data().lowAttendanceStudents || [];

          if (students.length === 0) continue;

          messages.push(`📘 ${data.courseName}`);

          students.forEach(s =>
            messages.push(`${s.name} → ${s.percent.toFixed(1)}%`)
          );
        }

        return sendReply(res, messages);

      }

      catch (error) {

        console.error(error);

        return sendReply(res, ["Error retrieving low attendance"]);

      }

    }

    /* =========================
       HIGH ATTENDANCE STUDENTS
    ========================= */

    if (intent === "Lecturer_High_Attendance") {

      console.log("Lecturer_High_Attendance triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        const messages = ["🏆 High Attendance Students"];

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const classId =
            `${data.courseId}_${data.branch}_${data.year}_${data.semester}_${data.academicYear}`;

          const analytics = await db
            .collection("class_analytics")
            .doc(classId)
            .get();

          if (!analytics.exists) continue;

          const students =
            analytics.data().highAttendanceStudents || [];

          messages.push(`📘 ${data.courseName}`);

          students.slice(0, 5).forEach(s =>
            messages.push(`${s.name} → ${s.percent.toFixed(1)}%`)
          );
        }

        return sendReply(res, messages);

      }

      catch (error) {

        console.error(error);

        return sendReply(res, ["Error retrieving high attendance"]);

      }

    }


    /* =========================
       CLASS AVERAGE ATTENDANCE
    ========================= */

    if (intent === "Lecturer_Class_Average") {

      console.log("Lecturer_Class_Average triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        const messages = ["📊 Class Average Attendance"];

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const classId =
            `${data.courseId}_${data.branch}_${data.year}_${data.semester}_${data.academicYear}`;

          const analytics = await db
            .collection("class_analytics")
            .doc(classId)
            .get();

          if (!analytics.exists) continue;

          const avg =
            analytics.data().classAverageAttendance || 0;

          messages.push(`${data.courseName} → ${avg.toFixed(1)}%`);
        }

        return sendReply(res, messages);

      }

      catch (error) {

        console.error(error);

        return sendReply(res, ["Error retrieving average attendance"]);

      }

    }

    /* =========================
       TOTAL SESSIONS
    ========================= */

    if (intent === "Lecturer_Total_Sessions") {

      console.log("Lecturer_Total_Sessions triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        const messages = ["📅 Total Classes Conducted"];

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const classId =
            `${data.courseId}_${data.branch}_${data.year}_${data.semester}_${data.academicYear}`;

          const analytics = await db
            .collection("class_analytics")
            .doc(classId)
            .get();

          if (!analytics.exists) continue;

          const sessions =
            analytics.data().totalSessions || 0;

          messages.push(`${data.courseName} → ${sessions} classes`);
        }

        return sendReply(res, messages);

      }

      catch (error) {

        console.error(error);

        return sendReply(res, ["Error retrieving sessions"]);

      }

    }


    /* =========================
       HIGHEST ATTENDANCE CLASS
    ========================= */

    if (intent === "Lecturer_Highest_Attendance_Class") {

      console.log("Lecturer_Highest_Attendance_Class triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        if (assignSnap.empty) {
          return sendReply(res, ["You are not assigned to any classes."]);
        }

        let highestCourse = "";
        let highestPercent = 0;

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const classId =
            `${data.courseId}_${data.branch}_${data.year}_${data.semester}_${data.academicYear}`;

          const analytics = await db
            .collection("class_analytics")
            .doc(classId)
            .get();

          if (!analytics.exists) continue;

          const avg =
            analytics.data().classAverageAttendance || 0;

          if (avg > highestPercent) {
            highestPercent = avg;
            highestCourse = data.courseName;
          }

        }

        return sendReply(res, [
          "📈 Highest Attendance Class",
          `${highestCourse} → ${highestPercent.toFixed(1)}%`
        ]);

      }

      catch (error) {

        console.error(error);

        return sendReply(res, ["Error retrieving highest attendance"]);

      }

    }


    /* =========================
       LOWEST ATTENDANCE CLASS
    ========================= */

    if (intent === "Lecturer_Lowest_Attendance_Class") {

      console.log("Lecturer_Lowest_Attendance_Class triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        if (assignSnap.empty) {
          return sendReply(res, ["You are not assigned to any classes."]);
        }

        let lowestCourse = "";
        let lowestPercent = 100;

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const classId =
            `${data.courseId}_${data.branch}_${data.year}_${data.semester}_${data.academicYear}`;

          const analytics = await db
            .collection("class_analytics")
            .doc(classId)
            .get();

          if (!analytics.exists) continue;

          const avg =
            analytics.data().classAverageAttendance || 0;

          if (avg < lowestPercent) {
            lowestPercent = avg;
            lowestCourse = data.courseName;
          }

        }

        return sendReply(res, [
          "📉 Lowest Attendance Class",
          `${lowestCourse} → ${lowestPercent.toFixed(1)}%`
        ]);

      }

      catch (error) {

        console.error(error);

        return sendReply(res, ["Error retrieving lowest attendance"]);

      }

    }


    /* =========================
       CLASS STRENGTH RANKING
    ========================= */

    if (intent === "Lecturer_Class_Strength_Ranking") {

      console.log("Lecturer_Class_Strength_Ranking triggered");

      if (!requireLecturer(res, role)) return;

      try {

        const assignSnap = await db
          .collection("lecturer_assignments")
          .where("lecturerUid", "==", uid)
          .get();

        if (assignSnap.empty) {
          return sendReply(res, ["You are not assigned to any classes."]);
        }

        const classes = [];

        for (const doc of assignSnap.docs) {

          const data = doc.data();

          const classId =
            `${data.courseId}_${data.branch}_${data.year}_${data.semester}_${data.academicYear}`;

          const analytics = await db
            .collection("class_analytics")
            .doc(classId)
            .get();

          if (!analytics.exists) continue;

          const total =
            analytics.data().totalStudents || 0;

          classes.push({
            course: data.courseName,
            students: total
          });

        }

        classes.sort((a, b) => b.students - a.students);

        const messages = ["👨‍🎓 Class Strength Ranking"];

        classes.forEach(c => {
          messages.push(`${c.course} → ${c.students} students`);
        });

        return sendReply(res, messages);

      }

      catch (error) {

        console.error(error);

        return sendReply(res, ["Error retrieving class strength ranking"]);

      }

    }

    return sendReplies(res, [
      "Ask me about your attendance."
    ]);

  }

  catch (err) {

    console.error("CHATBOT ERROR:", err);

    return sendReplies(res, [
      "Something went wrong."
    ]);

  }

});



/*===================
STUDENT ANALYTICS
===================================*/

app.get("/student/analytics/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    // 1️⃣ Get enrolled courses
    const enrollSnap = await db.collection("enrollment_requests")
      .where("studentUid", "==", uid)
      .where("status", "==", "approved")
      .get();

    const enrolledMap = {}; // courseId -> courseName

    enrollSnap.forEach(doc => {
      const d = doc.data();
      enrolledMap[d.courseId] = d.courseName;
    });

    // 2️⃣ Get attendance data
    const snap = await db
      .collection("attendance_summary")
      .doc(uid)
      .collection("courses")
      .get();

    const courseStats = {};
    let totalSessions = 0;
    let totalAttended = 0;

    snap.forEach(doc => {

      // 🔥 IMPORTANT FIX: extract courseId
      const fullId = doc.id;
      const courseId = fullId.split("_")[0];

      const data = doc.data();

      const sessions = data.totalClasses || 0;
      const attended = data.attended || 0;

      totalSessions += sessions;
      totalAttended += attended;

      if (!courseStats[courseId]) {
        courseStats[courseId] = { total: 0, attended: 0 };
      }

      courseStats[courseId].total += sessions;
      courseStats[courseId].attended += attended;
    });

    // 3️⃣ Merge enrolled + attendance
    const courses = [];

    for (const courseId in enrolledMap) {
      const stats = courseStats[courseId] || { total: 0, attended: 0 };

      const percent =
        stats.total === 0 ? 0 : (stats.attended / stats.total) * 100;

      courses.push({
        name: enrolledMap[courseId],
        attendance: percent
      });
    }

    // 4️⃣ Overall attendance
    const overallAttendance =
      totalSessions === 0 ? 0 :
      (totalAttended / totalSessions) * 100;

    res.json({
      courses,
      overallAttendance,
      totalSessions
    });

  } catch (err) {
    console.error("STUDENT ANALYTICS ERROR:", err);
    res.status(500).json({ error: "Failed" });
  }
});



/*=======================
LECTURER ANALYTICS
===============================*/
app.get("/lecturer/analytics/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    const assignmentsSnap = await db
      .collection("lecturer_assignments")
      .where("lecturerUid", "==", uid)
      .get();

    if (assignmentsSnap.empty) {
      return res.json({
        totalClassesTaught: 0,
        totalStudentsAcrossClasses: 0,
        overallAverageAttendance: 0,
        classes: []
      });
    }

    const classes = [];
    let totalStudentsAcrossClasses = 0;
    let sumAverageAttendance = 0;

    for (const doc of assignmentsSnap.docs) {

      const data = doc.data();

      // ✅ FIX YEAR
      const courseId = data.courseId;
      const courseName = data.courseName;
      const branch = data.branch;
      const year = data.year || data.currentYear; // 🔥 FIX
      const semester = data.semester;
      const academicYear = data.academicYear;

      const classId = `${courseId}_${branch}_${year}_${semester}_${academicYear}`;

      let totalStudents = 0;
      let averageAttendance = 0;
      let totalSessions = 0;

      const analyticsDoc = await db.collection("class_analytics").doc(classId).get();

      if (analyticsDoc.exists) {
        const a = analyticsDoc.data();
        totalStudents = a.totalStudents || 0;
        averageAttendance = a.classAverageAttendance || 0;
        totalSessions = a.totalSessions || 0;
      } else {
        const studentsSnap = await db
          .collection("student_courses")
          .doc(classId)
          .collection("students")
          .get();

        totalStudents = studentsSnap.size;
        averageAttendance = 0;
      }

      totalStudentsAcrossClasses += totalStudents;
      sumAverageAttendance += averageAttendance;

      classes.push({
        classId,
        courseName,
        branch,
        year, // ✅ NOW INCLUDED
        semester,
        totalStudents,
        averageAttendance,
        totalSessions
      });
    }

    const totalClassesTaught = assignmentsSnap.size;

    const overallAverageAttendance =
      totalClassesTaught === 0
        ? 0
        : sumAverageAttendance / totalClassesTaught;

    res.json({
      totalClassesTaught,
      totalStudentsAcrossClasses,
      overallAverageAttendance,
      classes
    });

  } catch (err) {
    console.error("Error fetching lecturer analytics:", err);
    res.status(500).json({ error: "Failed to load lecturer analytics" });
  }
});

/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});






