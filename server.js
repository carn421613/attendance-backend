require("dotenv").config();
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("./cloudinary");

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

    const { uid, roll, courseId } = req.body;

    if (!uid || !roll || !courseId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: "At least 2 photos required" });
    }

    /* VALIDATE COURSE */

    const courseDoc = await db.collection("courses").doc(courseId).get();

    if (!courseDoc.exists) {
      return res.status(400).json({ error: "Invalid course selected" });
    }

    const courseName = courseDoc.data().name;

    /* CHECK DUPLICATE ENROLLMENT */

    const existingEnrollment =
      await db.collection("student_courses")
        .doc(courseId)
        .collection("students")
        .doc(uid)
        .get();

    if (existingEnrollment.exists) {
      return res.status(400).json({
        error: `You are already enrolled in ${courseName}`
      });
    }

    /* CHECK PENDING REQUEST */

    const existingRequest = await db
      .collection("enrollment_requests")
      .where("studentUid", "==", uid)
      .where("courseId", "==", courseId)
      .where("status", "==", "pending")
      .get();

    if (!existingRequest.empty) {
      return res.status(400).json({
        error: `You already have a pending request for ${courseName}`
      });
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

    if (!requestSnap.exists) {
      return res.status(404).json({ error: "Request not found" });
    }

    const request = requestSnap.data();

    const { courseId, courseName, studentUid, roll } = request;

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

    /* CHECK CURRENT SEATS */

    const courseRef =
      db.collection("student_courses").doc(courseId);

    const courseDoc = await courseRef.get();

    const seatCount =
      courseDoc.exists ? (courseDoc.data().count || 0) : 0;

    console.log("Current seats:", seatCount);

    /* SEATS FULL */

    if (seatCount >= rule.seatLimit) {

      if (Number(student.cgpa) >= rule.strictCgpa) {

        console.log("Approved under strict CGPA");

      } else {

        await requestRef.update({ status: "waitlisted" });

        return res.json({
          message: "Added to waitlist"
        });
      }
    }

    /* NORMAL APPROVAL */

    console.log("Normal approval");

    /* Ensure course doc exists */

    await courseRef.set({

      courseId,
      course: courseName,
      count: admin.firestore.FieldValue.increment(0)

    }, { merge: true });

    /* Add student */

    await courseRef
      .collection("students")
      .doc(studentUid)
      .set({

        studentUid,
        roll,
        enrolledAt:
          admin.firestore.FieldValue.serverTimestamp()

      });

    /* Increment count */

    await courseRef.set({

      count: admin.firestore.FieldValue.increment(1)

    }, { merge: true });

    await requestRef.update({ status: "approved" });

    await db
      .collection("users")
      .doc(studentUid)
      .set(
        {
          enrolledCourses: admin.firestore.FieldValue.arrayUnion(courseName)
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
    ).catch(() => { });

    res.json({
      message: "Class photo uploaded successfully",
      sessionId
    });

  } catch (err) {
    console.error("UPLOAD CLASS PHOTO ERROR:", err);
    res.status(500).json({ error: "Upload failed" });
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

function sendReply(res, text) {

  return res.json({
    fulfillmentMessages: [
      {
        text: {
          text: [text]
        }
      }
    ]
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

      if (session) {
        uid = session.split("/").pop();
      }

    } catch { }

    console.log("UID RECEIVED:", uid);


    /* =========================
       FETCH USER ROLE
    ========================= */

    let role = "student";

    try {

      const userDoc = await db.collection("users").doc(uid).get();

      if (userDoc.exists) {
        role = userDoc.data().role || "student";
      }

    } catch { }

    console.log("USER ROLE:", role);



    /* =========================
       GREETING
    ========================= */

    if (intent === "Greeting") {

      return sendReply(
        res,
        "Hello! I am your Attendance Assistant."
      );

    }



    /* =========================
       ATTENDANCE SUMMARY
    ========================= */

    if (intent === "Attendance_summary") {

      if (!requireStudent(res, role)) return;

      const snap = await db
        .collection("attendance_summary")
        .doc(uid)
        .collection("courses")
        .get();

      if (snap.empty) {
        return sendReply(res, "No attendance records found yet.");
      }

      let total = 0;
      let attended = 0;

      let response = "📊 Attendance Report\n\n";

      for (const doc of snap.docs) {

        const courseId = doc.id;
        const data = doc.data();

        const courseInfo = await db
          .collection("courses")
          .doc(courseId)
          .get();

        const courseName =
          courseInfo.data()?.name || courseId;

        const t = data.totalClasses || 0;
        const a = data.attended || 0;
        const m = t - a;

        const percent =
          t === 0 ? 0 : ((a / t) * 100).toFixed(1);

        total += t;
        attended += a;

        response +=
          `${courseName}
Total Classes : ${t}
Attended      : ${a}
Missed        : ${m}
Attendance    : ${percent}%\n\n`;

      }

      const overall =
        total === 0 ? 0 : ((attended / total) * 100).toFixed(1);

      response += `Overall Attendance : ${overall}%\n`;

      if (overall < 75)
        response += "⚠️ Your attendance is below 75%";
      else
        response += "✅ Your attendance is safe";

      return sendReply(res, response);

    }



    /* =========================
       COURSE ATTENDANCE
    ========================= */

    if (intent === "Attendance_course") {

      if (!requireStudent(res, role)) return;

      const parameters = req.body.queryResult.parameters || {};
      const courseInput = parameters.course || "";

      const course = await getCourseIdFromAlias(courseInput);

      if (!course)
        return sendReply(res, "I couldn't recognize that course.");

      const courseId = course.id;
      const courseName = course.name;

      const enrollmentSnap = await db
        .collection("enrollments")
        .doc(courseId)
        .collection("students")
        .doc(uid)
        .get();

      if (!enrollmentSnap.exists)
        return sendReply(res, `You are not enrolled in ${courseName}`);

      const doc = await db
        .collection("attendance_summary")
        .doc(uid)
        .collection("courses")
        .doc(courseId)
        .get();

      if (!doc.exists)
        return sendReply(res, "No attendance records found yet.");

      const data = doc.data();

      const total = data.totalClasses || 0;
      const attended = data.attended || 0;
      const missed = total - attended;

      const percent =
        total === 0 ? 0 : ((attended / total) * 100).toFixed(1);

      return sendReply(res,
        `📘 ${courseName}

Total Classes : ${total}
Attended      : ${attended}
Missed        : ${missed}
Attendance    : ${percent}%`
      );

    }



    /* =========================
       ATTENDANCE WARNING
    ========================= */

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
        return sendReply(res, "No attendance records yet.");

      const percent = ((attended / total) * 100).toFixed(1);

      if (percent < 75)
        return sendReply(res,
          `⚠️ Warning

Current Attendance : ${percent}%

You are below the required 75%.
Attend upcoming classes.`);

      return sendReply(res,
        `✅ Attendance Safe
Current Attendance : ${percent}%`);

    }



    /* =========================
       MISSED CLASSES
    ========================= */

    if (intent === "missed_classes") {

      if (!requireStudent(res, role)) return;

      const snap = await db
        .collection("attendance_summary")
        .doc(uid)
        .collection("courses")
        .get();

      let totalMissed = 0;
      let response = "📊 Missed Classes Report\n\n";

      for (const doc of snap.docs) {

        const data = doc.data();

        const courseId = doc.id;

        const courseInfo =
          await db.collection("courses").doc(courseId).get();

        const name = courseInfo.data()?.name || courseId;

        const missed =
          (data.totalClasses || 0) - (data.attended || 0);

        totalMissed += missed;

        response += `${name} → ${missed} classes missed\n`;

      }

      response += `\nTotal Missed Classes : ${totalMissed}`;

      return sendReply(res, response);

    }





    /* =========================
       COURSES ENROLLED
    ========================= */

    if (intent === "Courses_Enrolled") {

  console.log("Courses_Enrolled intent triggered");

  if (!requireStudent(res, role)) return;

  try {

    const userDoc = await db.collection("users").doc(uid).get();

    const data = userDoc.data();

    if (!data.enrolledCourses || data.enrolledCourses.length === 0) {
      return sendReply(res, "You are not enrolled in any courses.");
    }

    let response = "📚 Your Enrolled Courses\n\n";

    data.enrolledCourses.forEach(course => {
      response += `• ${course}\n`;
    });

    return sendReply(res, response);

  } catch (error) {

    console.error("Courses_Enrolled error:", error);

    return sendReply(res, "Error retrieving enrolled courses.");

  }

}





    /* =========================
       REMAINING BUNK
    ========================= */

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

      const remaining =
        Math.floor((attended / minAttendance) - total);

      if (remaining <= 0)
        return sendReply(res,
          `⚠️ Attendance Limit Reached

You cannot miss any more classes.`);

      return sendReply(res,
        `📌 Remaining Bunks

You can miss ${remaining} more class(es).`);

    }


    /* =========================
    ENROLLMENT STATUS
 ========================= */

    if (intent === "Enrollment_Status") {

      console.log("Enrollment_Status intent triggered");

      // Only students can access
      if (!requireStudent(res, role)) return;

      try {

        // Get all enrollment requests for this student
        const snap = await db
          .collection("enrollment_requests")
          .where("studentUid", "==", uid)
          .get();

        // If no requests found
        if (snap.empty) {
          return sendReply(
            res,
            "You have not submitted any enrollment requests."
          );
        }

        let response = "📄 Enrollment Status\n\n";

        /* =========================
           FETCH COURSE NAMES IN PARALLEL
        ========================= */

        const promises = snap.docs.map(async (doc) => {

          const data = doc.data();

          try {

            const courseDoc = await db
              .collection("courses")
              .doc(data.courseId)
              .get();

            const courseName =
              courseDoc.exists
                ? courseDoc.data().name
                : data.courseId;

            return `${courseName} → ${data.status}`;

          }

          catch (error) {

            console.error("Course fetch error:", error);

            return `${data.courseId} → ${data.status}`;

          }

        });

        // Wait for all course fetches simultaneously
        const results = await Promise.all(promises);

        response += results.join("\n");

        return sendReply(res, response);

      }

      catch (error) {

        console.error("Enrollment status error:", error);

        return sendReply(
          res,
          "Sorry, I couldn't retrieve your enrollment status."
        );

      }

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

        if (coursesSnap.empty) {
          return sendReply(res, "No attendance records found yet.");
        }

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

          return sendReply(res,
            `📉 Lowest Attendance

Course : ${lowestCourse}
Attendance : ${lowestPercent.toFixed(1)}%`);

        }

        if (userQuery.includes("highest")) {

          return sendReply(res,
            `📈 Highest Attendance

Course : ${highestCourse}
Attendance : ${highestPercent.toFixed(1)}%`);

        }

        return sendReply(res,
          `📊 Attendance Analysis

Lowest Attendance : ${lowestCourse} (${lowestPercent.toFixed(1)}%)
Highest Attendance : ${highestCourse} (${highestPercent.toFixed(1)}%)`);

      }

      catch (error) {

        console.error("Attendance analysis error:", error);

        return sendReply(res, "Sorry, I couldn't analyze your attendance.");

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

        if (coursesSnap.empty) {
          return sendReply(res, "No attendance records found yet.");
        }

        let totalClasses = 0;
        let attended = 0;

        coursesSnap.forEach(doc => {

          const data = doc.data();

          totalClasses += data.totalClasses || 0;
          attended += data.attended || 0;

        });

        if (totalClasses === 0) {
          return sendReply(res, "No classes recorded yet.");
        }

        const newTotal = totalClasses + futureMissed;

        const newPercent = ((attended / newTotal) * 100).toFixed(1);

        let responseText =
          `📊 Attendance Prediction

Current Attendance : ${((attended / totalClasses) * 100).toFixed(1)}%

If you miss ${futureMissed} upcoming classes:

New Attendance : ${newPercent}%`;

        if (newPercent < 75) {

          responseText +=
            `

⚠️ This will drop your attendance below 75%.`;

        } else {

          responseText +=
            `

✅ Your attendance will remain above 75%.`;

        }

        return sendReply(res, responseText);

      }

      catch (error) {

        console.error("Attendance prediction error:", error);

        return sendReply(res, "Sorry, I couldn't calculate the prediction.");

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

        if (coursesSnap.empty) {
          return sendReply(res, "No attendance records found yet.");
        }

        let totalClasses = 0;
        let attended = 0;

        coursesSnap.forEach(doc => {

          const data = doc.data();

          totalClasses += data.totalClasses || 0;
          attended += data.attended || 0;

        });

        if (totalClasses === 0) {
          return sendReply(res, "No classes recorded yet.");
        }

        const percent = ((attended / totalClasses) * 100).toFixed(1);

        const requiredAttendance = 0.75;

        let advice = "";

        if (percent < 75) {

          const classesNeeded =
            Math.ceil((requiredAttendance * totalClasses - attended) / (1 - requiredAttendance));

          advice =
            `⚠️ Attendance Alert

Current Attendance : ${percent}%

You must attend the next ${classesNeeded} classes continuously
to reach the required 75% attendance.`;

        } else {

          const remaining =
            Math.floor((attended / requiredAttendance) - totalClasses);

          advice =
            `✅ Attendance Status : Safe

Current Attendance : ${percent}%

You can miss ${remaining} more class(es)
without dropping below 75%.`;

        }

        return sendReply(res, advice);

      }

      catch (error) {

        console.error("Smart advisor error:", error);

        return sendReply(res, "Sorry, I couldn't generate attendance advice.");

      }

    }

    /* =========================
       AI FALLBACK
    ========================= */

    if (intent === "Default Fallback Intent") {

      const userMessage = req.body.queryResult.queryText;

      const aiReply = await askAI(userMessage);

      return sendReply(res, aiReply);

    }



    /* =========================
       LECTURER COURSES
    ========================= */

    if (intent === "Lecturer_Courses") {

      if (!requireLecturer(res, role)) return;

      const snap = await db
        .collection("lecturer_courses")
        .where("lecturerUid", "==", uid)
        .get();

      if (snap.empty)
        return sendReply(res,
          "You are not assigned to any courses.");

      let response = "📚 Your Assigned Courses\n\n";

      for (const doc of snap.docs) {

        const data = doc.data();

        const courseInfo =
          await db.collection("courses")
            .doc(data.courseId).get();

        const name =
          courseInfo.data()?.name || data.courseId;

        response +=
          `${name}
Branch : ${data.branch}
Year : ${data.year}
Semester : ${data.semester}\n\n`;

      }

      return sendReply(res, response);

    }



    return sendReply(
      res,
      "Ask me about your attendance."
    );

  }

  catch (err) {

    console.error("CHATBOT ERROR:", err);

    return sendReply(
      res,
      "Something went wrong."
    );

  }

});


/* =========================
   START SERVER
========================= */

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});






