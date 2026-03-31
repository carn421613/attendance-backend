import { auth } from "../js/firebase.js";

const BASE_URL = "https://attendance-backend-qj36.onrender.com";

const lecturerSelect = document.getElementById("lecturerUid");
const courseSelect = document.getElementById("courseId");

// 🔥 Store lecturer data locally (optional but useful)
let lecturerMap = {};


/* =========================
   LOAD LECTURERS
========================= */

async function loadLecturers() {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();

    const res = await fetch(`${BASE_URL}/users`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const users = await res.json();

    console.log("Fetched users:", users);

    lecturerSelect.innerHTML = `<option value="">Select Lecturer</option>`;

    users
      .filter(u => (u.role || "").toLowerCase() === "lecturer")
      .forEach(u => {

        // 🔥 store locally
        lecturerMap[u.uid] = {
          name: u.name || "No Name",
          email: u.email || "No Email"
        };

        const option = document.createElement("option");
        option.value = u.uid;

        option.textContent =
          `${lecturerMap[u.uid].name} (${lecturerMap[u.uid].email})`;

        lecturerSelect.appendChild(option);
      });

  } catch (error) {
    console.error("Error loading lecturers:", error);
    alert("Failed to load lecturers");
  }
}


/* =========================
   LOAD COURSES
========================= */

async function loadCourses() {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();

    const res = await fetch(`${BASE_URL}/courses`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const courses = await res.json();

    console.log("Fetched courses:", courses);

    courseSelect.innerHTML = `<option value="">Select Course</option>`;

    courses.forEach(c => {
      const option = document.createElement("option");

      option.value = c.id;

      // 🔥 Better display (code first)
      option.textContent = `${c.id} - ${c.name}`;

      courseSelect.appendChild(option);
    });

  } catch (error) {
    console.error("Error loading courses:", error);
    alert("Failed to load courses");
  }
}


/* =========================
   ASSIGN COURSE
========================= */

window.assignCourse = async function () {

  const lecturerUid = lecturerSelect.value;
  const courseId = courseSelect.value;

  const branch = document.getElementById("branch").value;
  const year = document.getElementById("year").value;
  const semester = document.getElementById("semester").value;
  const academicYear = document.getElementById("academicYear").value;

  if (!lecturerUid || !courseId || !branch || !year || !semester || !academicYear) {
    alert("Please fill all fields");
    return;
  }

  try {
    const user = auth.currentUser;
    if (!user) {
      alert("User not authenticated");
      return;
    }

    const token = await user.getIdToken();

    console.log("Assigning:", {
      lecturerUid,
      courseId,
      branch,
      year,
      semester,
      academicYear
    });

    const res = await fetch(`${BASE_URL}/assign-lecturer-course`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        lecturerUid,
        courseId,
        branch,
        year,
        semester,
        academicYear
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Assignment failed");
      return;
    }

    alert("✅ Course assigned successfully");

    // 🔥 Reset form
    document.querySelector("form").reset();

  } catch (error) {
    console.error("Assignment error:", error);
    alert("Something went wrong");
  }
};


/* =========================
   INIT
========================= */

auth.onAuthStateChanged(async (user) => {

  if (!user) {
    console.log("No user logged in");
    return;
  }

  console.log("User logged in:", user.uid);

  await loadLecturers();
  await loadCourses();

});