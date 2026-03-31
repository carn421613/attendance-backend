import { auth } from "../js/firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const BASE_URL = "https://attendance-backend-qj36.onrender.com";


/* =========================
   LOAD COURSES
========================= */

async function loadCourses() {

  try {

    const user = auth.currentUser;

    if (!user) {
      console.log("User not logged in yet");
      return;
    }

    const token = await user.getIdToken();

    const res = await fetch(`${BASE_URL}/courses`, {

      method: "GET",

      headers: {
        "Authorization": `Bearer ${token}`
      }

    });

    const courses = await res.json();

    console.log("COURSES RECEIVED:", courses);

    if (!Array.isArray(courses)) {
      console.error("Courses API did not return array:", courses);
      return;
    }

    const dropdown = document.getElementById("course");

    dropdown.innerHTML = `<option value="">-- Select Course --</option>`;

    courses.forEach(course => {

      const option = document.createElement("option");

      option.value = course.id;
      option.textContent = course.name;

      dropdown.appendChild(option);

    });

  }

  catch (err) {

    console.error("Failed to load courses:", err);

  }

}


/* =========================
   WAIT FOR LOGIN THEN LOAD
========================= */

onAuthStateChanged(auth, (user) => {

  if (user) {

    console.log("User logged in:", user.uid);

    loadCourses();

  }

});


/* =========================
   SUBMIT ENROLLMENT
========================= */

window.submitEnrollment = async function () {

  const roll = document.getElementById("roll").value;

  const courseId = document.getElementById("course").value;

  const photos = document.getElementById("photos").files;

  if (!roll || !courseId || photos.length < 2) {

    alert("Fill all fields and select at least 2 photos");

    return;

  }

  const user = auth.currentUser;

  if (!user) {

    alert("You are not logged in");

    return;

  }

  const formData = new FormData();

  formData.append("uid", user.uid);
  formData.append("roll", roll);
  formData.append("courseId", courseId);

  for (let i = 0; i < photos.length; i++) {

    formData.append("photos", photos[i]);

  }

  try {

    const response = await fetch(`${BASE_URL}/enroll`, {

      method: "POST",
      body: formData

    });

    const data = await response.json();

    if (!response.ok) {

      alert(data.error || "Enrollment failed");

      return;

    }

    alert(data.message);

  }

  catch (err) {

    console.error(err);

    alert("Server error");

  }

};